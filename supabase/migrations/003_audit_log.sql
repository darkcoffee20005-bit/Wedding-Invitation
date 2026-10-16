-- =============================================================================
-- 003_audit_log.sql
-- تسجيل العمليات الإدارية تلقائيًا + حماية السجل من التعديل والحذف.
-- يُسجَّل فقط ما ينفذه مستخدم مسجَّل في admin_users (وليس ردود الزوار).
-- لا تُسجَّل الرموز أو البصمات؛ فقط أسماء الحقول المتغيرة ووصف مختصر.
-- =============================================================================

create or replace function public.audit_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     jsonb;
  v_new     jsonb;
  v_fields  text[];
  v_action  text;
  v_summary text;
begin
  if v_uid is null or not exists (select 1 from public.admin_users a where a.user_id = v_uid) then
    return null;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_fields
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key not in ('updated_at');
    if v_fields is null then
      return null; -- لا تغيير فعلي
    end if;
  end if;

  v_action := case tg_table_name
    when 'rsvp_responses' then 'rsvp_' || lower(tg_op)
    when 'wedding_settings' then 'settings_update'
    when 'invitations' then
      case
        when tg_op = 'INSERT' then 'invitation_create'
        when tg_op = 'DELETE' then 'invitation_delete'
        when 'token_hash' = any (v_fields) then 'invitation_token_regenerate'
        else 'invitation_update'
      end
  end;

  v_summary := case tg_table_name
    when 'rsvp_responses' then
      left(coalesce(v_new ->> 'guest_name', v_old ->> 'guest_name'), 80)
      || ' | ' || coalesce(v_new ->> 'attendance', v_old ->> 'attendance')
      || ' | ' || coalesce(v_new ->> 'guest_count', v_old ->> 'guest_count')
    when 'invitations' then left(coalesce(v_new ->> 'guest_label', v_old ->> 'guest_label'), 120)
    else null
  end;

  insert into public.admin_audit_logs (admin_id, action, target_table, target_id, summary, changed_fields)
  values (v_uid, v_action, tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id'), v_summary, v_fields);

  return null;
end;
$$;

drop trigger if exists audit_rsvp_responses on public.rsvp_responses;
create trigger audit_rsvp_responses
  after insert or update or delete on public.rsvp_responses
  for each row execute function public.audit_admin_change();

drop trigger if exists audit_wedding_settings on public.wedding_settings;
create trigger audit_wedding_settings
  after update on public.wedding_settings
  for each row execute function public.audit_admin_change();

drop trigger if exists audit_invitations on public.invitations;
create trigger audit_invitations
  after insert or update or delete on public.invitations
  for each row execute function public.audit_admin_change();

-- السجل إلحاقي فقط: منع التعديل والحذف والتفريغ لأي دور عبر API.
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_logs is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists admin_audit_logs_no_update_delete on public.admin_audit_logs;
create trigger admin_audit_logs_no_update_delete
  before update or delete on public.admin_audit_logs
  for each row execute function public.prevent_audit_mutation();

drop trigger if exists admin_audit_logs_no_truncate on public.admin_audit_logs;
create trigger admin_audit_logs_no_truncate
  before truncate on public.admin_audit_logs
  for each statement execute function public.prevent_audit_mutation();

revoke all on function public.audit_admin_change() from public, anon, authenticated;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;
