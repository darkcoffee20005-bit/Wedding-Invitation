-- =============================================================================
-- 004_rsvp_public_api.sql
-- المسار الآمن لتسجيل الردود العامة.
-- هذه الدوال SECURITY DEFINER وممنوحة لـ service_role فقط، أي لا يستدعيها إلا
-- الـ Edge Function (supabase/functions/rsvp) بعد التحقق وتحديد معدل الطلبات.
-- الزائر لا يستطيع استدعاءها مباشرة عبر /rest/v1/rpc.
-- =============================================================================

-- بصمة SHA-256 للرمز (لا يُخزَّن الرمز نفسه).
create or replace function public.rsvp_hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(p_token, 'sha256');
$$;

-- رمز عشوائي قوي: 24 بايت (192 بت) بترميز base64url = 32 حرفًا.
create or replace function public.rsvp_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
$$;

create or replace function public.rsvp_token_is_wellformed(p_token text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_token is not null and p_token ~ '^[A-Za-z0-9_-]{32}$';
$$;

-- الإعدادات العامة التي تحتاجها صفحة الدعوة (بدون أي بيانات مدعوين).
create or replace function public.rsvp_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'groom_name', s.groom_name,
    'bride_name', s.bride_name,
    'event_date', s.event_date,
    'event_time', to_char(s.event_time, 'HH24:MI'),
    'timezone', s.timezone,
    'starts_at', ((s.event_date + s.event_time) at time zone s.timezone),
    'venue_name', s.venue_name,
    'venue_address', s.venue_address,
    'maps_url', s.maps_url,
    'duration_minutes', s.duration_minutes,
    'max_guests_per_response', s.max_guests_per_response,
    'show_calendar_button', s.show_calendar_button,
    'allow_open_rsvp', s.allow_open_rsvp,
    'rsvp_deadline', s.rsvp_deadline,
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or now() < s.rsvp_deadline)
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

-- تحديد معدل الطلبات: يعيد true إن كان الطلب مسموحًا.
-- يُستدعى في معاملة مستقلة قبل أي عملية حتى تُحتسب الطلبات المرفوضة أيضًا.
create or replace function public.rsvp_consume_rate_limit(
  p_client_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_client_key is null or char_length(p_client_key) < 8 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rsvp_rate_limits as r (key_hash, window_start, hits)
  values (extensions.digest(p_client_key, 'sha256'), v_window, 1)
  on conflict (key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- تنظيف النوافذ القديمة.
  delete from public.rsvp_rate_limits where window_start < now() - interval '1 day';

  return v_hits <= p_limit;
end;
$$;

-- تمثيل الرد المعاد للمدعو نفسه فقط.
create or replace function public.rsvp_response_public_json(r public.rsvp_responses)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'guest_name', r.guest_name,
    'attendance', r.attendance,
    'guest_count', r.guest_count,
    'message', r.message,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  );
$$;

-- سياق صفحة الدعوة: الإعدادات + (عند وجود رمز) بيانات الدعوة والرد السابق لصاحبها فقط.
create or replace function public.rsvp_get_context(
  p_invite_token text default null,
  p_edit_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings   jsonb := public.rsvp_public_settings();
  v_limit      integer;
  v_inv        public.invitations;
  v_resp       public.rsvp_responses;
  v_invitation jsonb := null;
  v_response   jsonb := null;
  v_edit_state text := null;
begin
  if v_settings is null then
    raise exception 'rsvp:settings_missing' using errcode = 'P0001';
  end if;
  v_limit := (v_settings ->> 'max_guests_per_response')::integer;

  if p_invite_token is not null and p_invite_token <> '' then
    if public.rsvp_token_is_wellformed(p_invite_token) then
      select * into v_inv from public.invitations i
      where i.token_hash = public.rsvp_hash_token(p_invite_token) and i.revoked_at is null;
    end if;

    if v_inv.id is null then
      v_invitation := jsonb_build_object('status', 'invalid');
    else
      v_invitation := jsonb_build_object(
        'status', 'valid',
        'guest_label', v_inv.guest_label,
        'max_guests', coalesce(v_inv.max_guests, v_limit)
      );
      select * into v_resp from public.rsvp_responses r where r.invitation_id = v_inv.id;
      if v_resp.id is not null then
        v_response := public.rsvp_response_public_json(v_resp);
      end if;
    end if;

  elsif p_edit_token is not null and p_edit_token <> '' then
    if public.rsvp_token_is_wellformed(p_edit_token) then
      select * into v_resp from public.rsvp_responses r
      where r.edit_token_hash = public.rsvp_hash_token(p_edit_token) and r.invitation_id is null;
    end if;
    if v_resp.id is not null then
      v_response := public.rsvp_response_public_json(v_resp);
      v_edit_state := 'valid';
    else
      v_edit_state := 'invalid';
    end if;
  end if;

  return jsonb_build_object(
    'settings', v_settings,
    'invitation', v_invitation,
    'edit_token', v_edit_state,
    'response', v_response
  );
end;
$$;

-- تسجيل أو تعديل الرد.
--  1) مع رمز دعوة شخصية: رد واحد لكل دعوة (إنشاء أو تعديل بنفس الرابط).
--  2) مع رمز تعديل (رد عام سابق من نفس الجهاز): تعديل ذلك الرد فقط.
--  3) بدون رموز: رد عام جديد (إن كان مسموحًا)، ويُعاد رمز تعديل مرة واحدة.
create or replace function public.rsvp_submit(
  p_invite_token text,
  p_edit_token text,
  p_request_id uuid,
  p_guest_name text,
  p_attendance text,
  p_guest_count integer,
  p_message text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings   jsonb := public.rsvp_public_settings();
  v_name       text := public.normalize_single_line(p_guest_name);
  v_message    text := public.normalize_multiline(p_message);
  v_count      integer;
  v_limit      integer;
  v_inv        public.invitations;
  v_resp       public.rsvp_responses;
  v_new_token  text := null;
  v_inserted   boolean;
  v_id         uuid;
begin
  if v_settings is null then
    raise exception 'rsvp:settings_missing' using errcode = 'P0001';
  end if;
  if not (v_settings ->> 'rsvp_open')::boolean then
    raise exception 'rsvp:closed' using errcode = 'P0001';
  end if;

  -- التحقق من المدخلات (مطابق لقيود الجدول، لكن برسائل محددة).
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'rsvp:invalid_name' using errcode = 'P0001';
  end if;
  if p_attendance is null or p_attendance not in ('attending', 'declined') then
    raise exception 'rsvp:invalid_attendance' using errcode = 'P0001';
  end if;
  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'rsvp:invalid_message' using errcode = 'P0001';
  end if;

  if p_attendance = 'declined' then
    v_count := 0; -- عند الاعتذار يُحفظ العدد صفرًا دائمًا.
  else
    v_count := p_guest_count;
    if v_count is null or v_count < 1 then
      raise exception 'rsvp:invalid_guest_count' using errcode = 'P0001';
    end if;
  end if;

  v_limit := (v_settings ->> 'max_guests_per_response')::integer;

  -- (1) دعوة شخصية
  if p_invite_token is not null and p_invite_token <> '' then
    if public.rsvp_token_is_wellformed(p_invite_token) then
      select * into v_inv from public.invitations i
      where i.token_hash = public.rsvp_hash_token(p_invite_token) and i.revoked_at is null;
    end if;
    if v_inv.id is null then
      raise exception 'rsvp:invalid_invitation' using errcode = 'P0001';
    end if;
    if v_count > coalesce(v_inv.max_guests, v_limit) then
      raise exception 'rsvp:guest_count_exceeds_limit' using errcode = 'P0001';
    end if;

    insert into public.rsvp_responses as r
      (invitation_id, guest_name, attendance, guest_count, message, source)
    values (v_inv.id, v_name, p_attendance, v_count, v_message, 'invitation')
    on conflict (invitation_id) do update
      set guest_name = excluded.guest_name,
          attendance = excluded.attendance,
          guest_count = excluded.guest_count,
          message = excluded.message
    returning r.id, (r.xmax = 0) into v_id, v_inserted;

  -- (2) تعديل رد عام سابق
  elsif p_edit_token is not null and p_edit_token <> '' then
    if v_count > v_limit then
      raise exception 'rsvp:guest_count_exceeds_limit' using errcode = 'P0001';
    end if;
    if public.rsvp_token_is_wellformed(p_edit_token) then
      update public.rsvp_responses r
        set guest_name = v_name, attendance = p_attendance, guest_count = v_count, message = v_message
      where r.edit_token_hash = public.rsvp_hash_token(p_edit_token) and r.invitation_id is null
      returning r.id into v_id;
    end if;
    if v_id is null then
      raise exception 'rsvp:invalid_edit_token' using errcode = 'P0001';
    end if;
    v_inserted := false;

  -- (3) رد عام جديد
  else
    if not (v_settings ->> 'allow_open_rsvp')::boolean then
      raise exception 'rsvp:invitation_required' using errcode = 'P0001';
    end if;
    if p_request_id is null then
      raise exception 'rsvp:invalid_request' using errcode = 'P0001';
    end if;
    if v_count > v_limit then
      raise exception 'rsvp:guest_count_exceeds_limit' using errcode = 'P0001';
    end if;

    v_new_token := public.rsvp_new_token();

    -- إعادة إرسال نفس الطلب (بعد انقطاع الشبكة مثلًا) تُحدّث نفس الصف ولا تكرره.
    insert into public.rsvp_responses as r
      (guest_name, attendance, guest_count, message, source, client_request_id, edit_token_hash)
    values (v_name, p_attendance, v_count, v_message, 'open', p_request_id, public.rsvp_hash_token(v_new_token))
    on conflict (client_request_id) do update
      set guest_name = excluded.guest_name,
          attendance = excluded.attendance,
          guest_count = excluded.guest_count,
          message = excluded.message,
          edit_token_hash = excluded.edit_token_hash
      where r.invitation_id is null and r.created_at > now() - interval '1 hour'
    returning r.id, (r.xmax = 0) into v_id, v_inserted;

    if v_id is null then
      raise exception 'rsvp:invalid_request' using errcode = 'P0001';
    end if;
  end if;

  select * into v_resp from public.rsvp_responses r where r.id = v_id;

  return jsonb_build_object(
    'mode', case when v_inserted then 'created' else 'updated' end,
    'edit_token', v_new_token,
    'response', public.rsvp_response_public_json(v_resp)
  );
end;
$$;

-- لا يستدعي هذه الدوال إلا service_role (الـ Edge Function).
revoke all on function public.rsvp_hash_token(text) from public, anon, authenticated;
revoke all on function public.rsvp_new_token() from public, anon, authenticated;
revoke all on function public.rsvp_token_is_wellformed(text) from public, anon, authenticated;
revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
revoke all on function public.rsvp_consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.rsvp_response_public_json(public.rsvp_responses) from public, anon, authenticated;
revoke all on function public.rsvp_get_context(text, text) from public, anon, authenticated;
revoke all on function public.rsvp_submit(text, text, uuid, text, text, integer, text) from public, anon, authenticated;

grant execute on function public.rsvp_public_settings() to service_role;
grant execute on function public.rsvp_consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.rsvp_get_context(text, text) to service_role;
grant execute on function public.rsvp_submit(text, text, uuid, text, text, integer, text) to service_role;
