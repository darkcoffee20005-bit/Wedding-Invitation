-- =============================================================================
-- 005_admin_api.sql
-- دوال لوحة الإدارة. كل دالة تتحقق من is_admin() داخليًا (لا يكفي إخفاء الواجهة).
-- =============================================================================

-- الإحصائيات مستمدة مباشرة من جدول الردود الفعلي.
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz         text;
  v_total      bigint;
  v_attending  bigint;
  v_declined   bigint;
  v_expected   bigint;
  v_inv_total  bigint;
  v_inv_resp   bigint;
  v_timeline   jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce((select s.timezone from public.wedding_settings s where s.id = 1), 'UTC') into v_tz;

  select count(*),
         count(*) filter (where r.attendance = 'attending'),
         count(*) filter (where r.attendance = 'declined'),
         coalesce(sum(r.guest_count) filter (where r.attendance = 'attending'), 0)
    into v_total, v_attending, v_declined, v_expected
  from public.rsvp_responses r;

  -- الدعوات الفعالة (غير الملغاة) وعدد ما وصله رد منها.
  select count(*),
         count(*) filter (where exists (select 1 from public.rsvp_responses r where r.invitation_id = i.id))
    into v_inv_total, v_inv_resp
  from public.invitations i
  where i.revoked_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', t.day, 'attending', t.attending, 'declined', t.declined, 'guests', t.guests
         ) order by t.day), '[]'::jsonb)
    into v_timeline
  from (
    select (r.created_at at time zone v_tz)::date as day,
           count(*) filter (where r.attendance = 'attending') as attending,
           count(*) filter (where r.attendance = 'declined') as declined,
           coalesce(sum(r.guest_count) filter (where r.attendance = 'attending'), 0) as guests
    from public.rsvp_responses r
    group by 1
  ) t;

  return jsonb_build_object(
    'total_responses', v_total,
    'attending_responses', v_attending,
    'declined_responses', v_declined,
    'expected_guests', v_expected,
    'average_guests_per_attending',
      case when v_attending > 0 then round(v_expected::numeric / v_attending, 2) else null end,
    'invitations_total', v_inv_total,
    -- null عند عدم وجود قائمة دعوات شخصية (لا يمكن حساب من لم يرد).
    'invitations_pending', case when v_inv_total > 0 then v_inv_total - v_inv_resp else null end,
    'timezone', v_tz,
    'timeline', v_timeline
  );
end;
$$;

-- إنشاء دعوة شخصية. يُعاد الرمز مرة واحدة فقط؛ القاعدة تحتفظ ببصمته.
create or replace function public.admin_create_invitation(
  p_guest_label text,
  p_max_guests integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_token := public.rsvp_new_token();
  insert into public.invitations (guest_label, max_guests, notes, token_hash)
  values (p_guest_label, p_max_guests, p_notes, public.rsvp_hash_token(v_token))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- إصدار رابط جديد (يُبطل الرابط القديم فورًا) وإعادة تفعيل الدعوة إن كانت ملغاة.
create or replace function public.admin_regenerate_invitation_token(p_invitation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_token := public.rsvp_new_token();
  update public.invitations
     set token_hash = public.rsvp_hash_token(v_token), revoked_at = null
   where id = p_invitation_id
  returning id into v_id;

  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.admin_create_invitation(text, integer, text) from public, anon;
revoke all on function public.admin_regenerate_invitation_token(uuid) from public, anon;

grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_create_invitation(text, integer, text) to authenticated;
grant execute on function public.admin_regenerate_invitation_token(uuid) to authenticated;
