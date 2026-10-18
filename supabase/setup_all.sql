-- =============================================================================
-- setup_all.sql — إعداد قاعدة البيانات كاملة دفعة واحدة (الملفات 001 إلى 009 مدموجة بالترتيب).
-- طريقة الاستخدام: Supabase ← SQL Editor ← New query ← الصق الملف كاملًا ← Run.
-- آمن لإعادة التشغيل: لا يحذف أي بيانات موجودة.
-- يُولَّد من supabase/migrations بالأمر: bash scripts/build-setup-sql.sh
-- =============================================================================



-- >>>>>>>>>> 001_initial_schema.sql
-- =============================================================================
-- 001_initial_schema.sql
-- الجداول الأساسية والقيود والفهارس ومحفزات التطبيع وتحديث وقت التعديل.
-- يُنفَّذ أولًا. آمن لإعادة التشغيل (idempotent) قدر الإمكان.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- دوال مساعدة عامة
-- -----------------------------------------------------------------------------

-- تحديث updated_at تلقائيًا عند كل تعديل.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- إزالة المسافات من الطرفين ودمج المسافات المتكررة في مسافة واحدة.
create or replace function public.normalize_single_line(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'), '^ | $', '', 'g'), '');
$$;

-- إزالة الفراغات من الطرفين مع الحفاظ على الأسطر الداخلية (للرسائل).
create or replace function public.normalize_multiline(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '^\s+|\s+$', '', 'g'), '');
$$;

-- -----------------------------------------------------------------------------
-- جدول إعدادات الزفاف (صف واحد فقط id = 1)
-- -----------------------------------------------------------------------------
create table if not exists public.wedding_settings (
  id                       smallint primary key default 1 check (id = 1),
  groom_name               text not null check (char_length(groom_name) between 1 and 60),
  bride_name               text not null check (char_length(bride_name) between 1 and 60),
  event_date               date not null,
  event_time               time not null,
  timezone                 text not null default 'Asia/Baghdad',
  venue_name               text not null check (char_length(venue_name) between 1 and 120),
  venue_address            text not null check (char_length(venue_address) between 1 and 250),
  -- رابط خرائط دقيق اختياري؛ إن كان فارغًا تُنشئ الواجهة رابط بحث من اسم القاعة والعنوان.
  maps_url                 text check (maps_url is null or (maps_url ~ '^https://' and char_length(maps_url) <= 1000)),
  -- مدة الحفل بالدقائق؛ اختيارية وغير مؤكدة (null = غير محددة).
  duration_minutes         integer check (duration_minutes is null or duration_minutes between 15 and 1440),
  -- الحد الأعلى لعدد البالغين في الرد الواحد (قابل للتعديل من لوحة الإدارة).
  max_guests_per_response  integer not null default 5 check (max_guests_per_response between 1 and 50),
  show_calendar_button     boolean not null default true,
  -- السماح بالرد عبر الرابط العام بدون رمز دعوة شخصية.
  allow_open_rsvp          boolean not null default true,
  -- إيقاف/تشغيل استقبال الردود يدويًا.
  rsvp_open                boolean not null default true,
  -- موعد نهائي اختياري لاستقبال الردود.
  rsvp_deadline            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create or replace function public.wedding_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.groom_name    := public.normalize_single_line(new.groom_name);
  new.bride_name    := public.normalize_single_line(new.bride_name);
  new.venue_name    := public.normalize_single_line(new.venue_name);
  new.venue_address := public.normalize_single_line(new.venue_address);
  new.maps_url      := public.normalize_single_line(new.maps_url);
  new.timezone      := btrim(new.timezone);

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists wedding_settings_before_write on public.wedding_settings;
create trigger wedding_settings_before_write
  before insert or update on public.wedding_settings
  for each row execute function public.wedding_settings_before_write();

drop trigger if exists wedding_settings_set_updated_at on public.wedding_settings;
create trigger wedding_settings_set_updated_at
  before update on public.wedding_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- جدول الدعوات الشخصية
-- لا يُخزَّن الرمز السري نفسه؛ يُخزَّن SHA-256 له فقط.
-- -----------------------------------------------------------------------------
create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  guest_label  text not null check (char_length(guest_label) between 1 and 120),
  token_hash   bytea not null unique,
  -- حد خاص بهذه الدعوة (مثلًا لعائلة)؛ null = يُستخدم الحد العام من الإعدادات.
  max_guests   integer check (max_guests is null or max_guests between 1 and 50),
  notes        text check (notes is null or char_length(notes) <= 500),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.invitations_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.guest_label := public.normalize_single_line(new.guest_label);
  new.notes       := public.normalize_multiline(new.notes);
  return new;
end;
$$;

drop trigger if exists invitations_before_write on public.invitations;
create trigger invitations_before_write
  before insert or update on public.invitations
  for each row execute function public.invitations_before_write();

drop trigger if exists invitations_set_updated_at on public.invitations;
create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

create index if not exists invitations_created_at_idx on public.invitations (created_at desc);

-- -----------------------------------------------------------------------------
-- جدول ردود المدعوين
-- -----------------------------------------------------------------------------
create table if not exists public.rsvp_responses (
  id                 uuid primary key default gen_random_uuid(),
  -- رد واحد لكل دعوة شخصية (UNIQUE يسمح بعدة قيم null للردود العامة).
  invitation_id      uuid unique references public.invitations (id) on delete set null,
  guest_name         text not null check (char_length(guest_name) between 2 and 80),
  attendance         text not null check (attendance in ('attending', 'declined')),
  -- عدد الأشخاص البالغين فقط (لا يوجد حقل للأطفال إطلاقًا).
  guest_count        integer not null check (guest_count between 0 and 50),
  message            text check (message is null or char_length(message) <= 500),
  -- بصمة رمز تعديل الرد العام (يُعطى للمتصفح مرة واحدة فقط).
  edit_token_hash    bytea unique,
  -- معرّف طلب يولّده المتصفح لمنع التكرار عند إعادة المحاولة بعد انقطاع الشبكة.
  client_request_id  uuid unique,
  source             text not null default 'open' check (source in ('invitation', 'open', 'admin')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint rsvp_guest_count_matches_attendance check (
    (attendance = 'attending' and guest_count >= 1)
    or (attendance = 'declined' and guest_count = 0)
  )
);

-- تطبيع النصوص وفرض الحد الأعلى لعدد الحضور من الإعدادات/الدعوة.
-- SECURITY DEFINER حتى يُقرأ الحد من الإعدادات بغض النظر عن RLS للمستدعي
-- (لا يمنح أي صلاحية كتابة إضافية؛ سياسات RLS على rsvp_responses تبقى سارية).
create or replace function public.rsvp_responses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  new.guest_name := public.normalize_single_line(new.guest_name);
  new.message    := public.normalize_multiline(new.message);

  if new.attendance = 'attending'
     and (tg_op = 'INSERT'
          or new.guest_count is distinct from old.guest_count
          or new.invitation_id is distinct from old.invitation_id) then

    select s.max_guests_per_response into v_limit from public.wedding_settings s where s.id = 1;
    if v_limit is null then
      raise exception 'settings_missing' using errcode = 'P0001';
    end if;

    if new.invitation_id is not null then
      select coalesce(i.max_guests, v_limit) into v_limit
      from public.invitations i where i.id = new.invitation_id;
    end if;

    if new.guest_count > v_limit then
      raise exception 'rsvp:guest_count_exceeds_limit'
        using errcode = 'P0001', detail = format('limit=%s', v_limit);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rsvp_responses_before_write on public.rsvp_responses;
create trigger rsvp_responses_before_write
  before insert or update on public.rsvp_responses
  for each row execute function public.rsvp_responses_before_write();

drop trigger if exists rsvp_responses_set_updated_at on public.rsvp_responses;
create trigger rsvp_responses_set_updated_at
  before update on public.rsvp_responses
  for each row execute function public.set_updated_at();

create index if not exists rsvp_responses_created_at_idx on public.rsvp_responses (created_at desc);
create index if not exists rsvp_responses_attendance_idx on public.rsvp_responses (attendance);

-- -----------------------------------------------------------------------------
-- سجل التدقيق الإداري (إلحاقي فقط)
-- لا يحتوي أي كلمات مرور أو رموز أو مفاتيح؛ فقط أسماء الحقول التي تغيّرت ووصف مختصر.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_audit_logs (
  id              bigint generated always as identity primary key,
  admin_id        uuid,
  action          text not null check (action in (
                    'rsvp_insert', 'rsvp_update', 'rsvp_delete',
                    'settings_update',
                    'invitation_create', 'invitation_update', 'invitation_delete',
                    'invitation_token_regenerate')),
  target_table    text not null,
  target_id       text,
  summary         text check (summary is null or char_length(summary) <= 500),
  changed_fields  text[],
  created_at      timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx on public.admin_audit_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- تحديد معدل الطلبات العامة (بصمة عنوان IP مملّحة، لا يُخزَّن العنوان نفسه)
-- -----------------------------------------------------------------------------
create table if not exists public.rsvp_rate_limits (
  key_hash      bytea not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key_hash, window_start)
);

create index if not exists rsvp_rate_limits_window_idx on public.rsvp_rate_limits (window_start);


-- >>>>>>>>>> 002_security_policies.sql
-- =============================================================================
-- 002_security_policies.sql
-- جدول المدراء، دالة is_admin()، تفعيل RLS، الصلاحيات، والسياسات.
-- المبدأ: الزائر المجهول (anon) لا يملك أي صلاحية على أي جدول.
-- الردود العامة تمر حصرًا عبر Edge Function → دوال SECURITY DEFINER (ملف 004).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- جدول المدراء: وجود المستخدم هنا هو ما يمنحه صلاحية الإدارة.
-- لا يمكن الإضافة إليه من الواجهة؛ يُضاف المدير الأول من SQL Editor فقط.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- تفعيل RLS على جميع الجداول المكشوفة عبر واجهة Supabase API
-- -----------------------------------------------------------------------------
alter table public.wedding_settings  enable row level security;
alter table public.invitations       enable row level security;
alter table public.rsvp_responses    enable row level security;
alter table public.admin_audit_logs  enable row level security;
alter table public.admin_users       enable row level security;
alter table public.rsvp_rate_limits  enable row level security;

-- -----------------------------------------------------------------------------
-- سحب كل الصلاحيات الافتراضية (Supabase يمنح anon/authenticated صلاحيات افتراضية
-- على الجداول الجديدة) ثم منح ما يلزم فقط.
-- -----------------------------------------------------------------------------
revoke all on table
  public.wedding_settings, public.invitations, public.rsvp_responses,
  public.admin_audit_logs, public.admin_users, public.rsvp_rate_limits
from public, anon, authenticated;

-- wedding_settings: المدير يقرأ ويعدّل الأعمدة القابلة للتعديل فقط.
grant select on public.wedding_settings to authenticated;
grant update (groom_name, bride_name, event_date, event_time, timezone, venue_name,
              venue_address, maps_url, duration_minutes, max_guests_per_response,
              show_calendar_button, allow_open_rsvp, rsvp_open, rsvp_deadline)
  on public.wedding_settings to authenticated;

-- invitations: القراءة والتعديل المحدود والحذف. الإنشاء وتجديد الرمز عبر دوال (ملف 005).
grant select, delete on public.invitations to authenticated;
grant update (guest_label, max_guests, notes, revoked_at) on public.invitations to authenticated;

-- rsvp_responses: المدير يقرأ ويعدّل الحقول الأساسية ويحذف ويضيف ردًا يدويًا.
-- لا يُمنح تعديل invitation_id أو edit_token_hash أو client_request_id.
grant select, delete on public.rsvp_responses to authenticated;
grant insert (guest_name, attendance, guest_count, message, source) on public.rsvp_responses to authenticated;
grant update (guest_name, attendance, guest_count, message) on public.rsvp_responses to authenticated;

-- admin_audit_logs: قراءة فقط للمدراء. لا إدراج/تعديل/حذف مباشر (المحفزات تكتب فيه).
grant select on public.admin_audit_logs to authenticated;

-- admin_users و rsvp_rate_limits: لا صلاحيات لأي دور عام.

-- -----------------------------------------------------------------------------
-- السياسات (تُطبَّق على الدور authenticated؛ anon لا يملك صلاحيات أصلًا)
-- -----------------------------------------------------------------------------
drop policy if exists "admins read settings" on public.wedding_settings;
create policy "admins read settings" on public.wedding_settings
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update settings" on public.wedding_settings;
create policy "admins update settings" on public.wedding_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read invitations" on public.invitations;
create policy "admins read invitations" on public.invitations
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update invitations" on public.invitations;
create policy "admins update invitations" on public.invitations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete invitations" on public.invitations;
create policy "admins delete invitations" on public.invitations
  for delete to authenticated using (public.is_admin());

drop policy if exists "admins read responses" on public.rsvp_responses;
create policy "admins read responses" on public.rsvp_responses
  for select to authenticated using (public.is_admin());

drop policy if exists "admins insert manual responses" on public.rsvp_responses;
create policy "admins insert manual responses" on public.rsvp_responses
  for insert to authenticated
  with check (public.is_admin() and source = 'admin' and invitation_id is null);

drop policy if exists "admins update responses" on public.rsvp_responses;
create policy "admins update responses" on public.rsvp_responses
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete responses" on public.rsvp_responses;
create policy "admins delete responses" on public.rsvp_responses
  for delete to authenticated using (public.is_admin());

drop policy if exists "admins read audit logs" on public.admin_audit_logs;
create policy "admins read audit logs" on public.admin_audit_logs
  for select to authenticated using (public.is_admin());

-- الدوال المساعدة من ملف 001 لا تُستدعى عبر API.
revoke all on function public.set_updated_at() from public, anon, authenticated;
-- دوال التطبيع نقية بلا آثار جانبية؛ تحتاجها محفزات التعديل التي ينفذها المدير.
revoke all on function public.normalize_single_line(text) from public, anon;
revoke all on function public.normalize_multiline(text) from public, anon;
grant execute on function public.normalize_single_line(text) to authenticated, service_role;
grant execute on function public.normalize_multiline(text) to authenticated, service_role;
revoke all on function public.wedding_settings_before_write() from public, anon, authenticated;
revoke all on function public.invitations_before_write() from public, anon, authenticated;
revoke all on function public.rsvp_responses_before_write() from public, anon, authenticated;


-- >>>>>>>>>> 003_audit_log.sql
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


-- >>>>>>>>>> 004_rsvp_public_api.sql
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


-- >>>>>>>>>> 005_admin_api.sql
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


-- >>>>>>>>>> 006_seed_wedding_settings.sql
-- =============================================================================
-- 006_seed_wedding_settings.sql
-- بيانات الزفاف الأولية (صف واحد). لا تُضاف أي ردود أو بيانات تجريبية.
-- maps_url و duration_minutes تُترك فارغة لأنها غير محددة بعد؛ عدّلها من لوحة الإدارة.
-- لا يستبدل الإعدادات إن كانت موجودة مسبقًا.
-- =============================================================================
insert into public.wedding_settings (
  id, groom_name, bride_name, event_date, event_time, timezone,
  venue_name, venue_address, maps_url, duration_minutes,
  max_guests_per_response, show_calendar_button, allow_open_rsvp, rsvp_open, rsvp_deadline
) values (
  1, 'يوسف', 'شذى', date '2027-05-27', time '16:00', 'Asia/Baghdad',
  'مزرعة الفرح', 'الغابات على نهر دجلة', null, null,
  15, true, true, true, null
)
on conflict (id) do nothing;


-- >>>>>>>>>> 007_editable_content.sql
-- =============================================================================
-- 007_editable_content.sql
-- جعل كل نصوص صفحة الدعوة وعناوينها وخيارات المشاركة قابلة للتعديل من لوحة الإدارة.
-- القيم الافتراضية = النصوص الحالية للصفحة (ومنها نص ملاحظة الأطفال حرفيًا).
-- آمن لإعادة التشغيل.
-- =============================================================================

alter table public.wedding_settings
  -- نصوص الافتتاحية (اختيارية: الفراغ يُخفي العنصر)
  add column if not exists verse_text          text default '﴿وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً﴾',
  add column if not exists intro_line          text default 'بكل الحب والفرح',
  add column if not exists tagline             text default 'يتشرفان بدعوتكم لمشاركتهما فرحة حفل زفافهما',
  add column if not exists invitation_message  text default 'بقلوبٍ يملؤها الفرح، وبمشاعر الامتنان لله، يسعدنا أن تكونوا معنا في يومٍ ننتظره بشوق، لنبدأ معًا فصلًا جديدًا من الحياة. حضوركم يكمل فرحتنا ويزيدها جمالًا.',
  -- عناوين الأقسام (مطلوبة)
  add column if not exists details_title       text not null default 'موعد الفرح',
  add column if not exists countdown_title     text not null default 'العد التنازلي ليوم الفرح',
  add column if not exists countdown_done_text text not null default 'حلّ يوم الفرح! شكرًا لمشاركتكم فرحتنا 🤍',
  add column if not exists actions_title       text not null default 'شاركونا الفرحة',
  add column if not exists rsvp_title          text not null default 'هل ستشاركوننا فرحتنا؟',
  add column if not exists rsvp_lead           text default 'يسعدنا تأكيد حضوركم لنستعد لاستقبالكم بأجمل صورة.',
  add column if not exists footer_text         text default 'بانتظاركم لنصنع معًا أجمل الذكريات',
  -- ملاحظة الأطفال (كل سطر = فقرة)
  add column if not exists show_children_note  boolean not null default true,
  add column if not exists children_note_title text not null default 'ملاحظة مهمة لضيوفنا الكرام',
  add column if not exists children_note_body  text default E'نعتذر منكم بكل محبة، ونرجو من ضيوفنا الكرام عدم اصطحاب الأطفال إلى الحفل، حيث إن الدعوة مخصصة للكبار فقط.\nشاكرين لكم تفهّمكم وتعاونكم، ونتطلع إلى مشاركتكم فرحتنا بأجمل الأوقات.',
  -- المشاركة
  add column if not exists share_closing_text  text default 'حضوركم يزيدنا فرحًا وشرفًا، ودمتم بخير ومحبة.',
  add column if not exists whatsapp_number     text,
  add column if not exists site_url            text;

-- القيود (تُضاف مرة واحدة)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_content_lengths') then
    alter table public.wedding_settings add constraint wedding_settings_content_lengths check (
          coalesce(char_length(verse_text), 0)         <= 400
      and coalesce(char_length(intro_line), 0)         <= 120
      and coalesce(char_length(tagline), 0)            <= 200
      and coalesce(char_length(invitation_message), 0) <= 1000
      and char_length(details_title)       between 1 and 80
      and char_length(countdown_title)     between 1 and 80
      and char_length(countdown_done_text) between 1 and 200
      and char_length(actions_title)       between 1 and 80
      and char_length(rsvp_title)          between 1 and 120
      and coalesce(char_length(rsvp_lead), 0)          <= 300
      and coalesce(char_length(footer_text), 0)        <= 200
      and char_length(children_note_title) between 1 and 120
      and coalesce(char_length(children_note_body), 0) <= 1000
      and coalesce(char_length(share_closing_text), 0) <= 300
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_children_note_body') then
    alter table public.wedding_settings add constraint wedding_settings_children_note_body
      check (not show_children_note or children_note_body is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_whatsapp_number') then
    alter table public.wedding_settings add constraint wedding_settings_whatsapp_number
      check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_site_url') then
    alter table public.wedding_settings add constraint wedding_settings_site_url
      check (site_url is null or (site_url ~ '^https://' and char_length(site_url) <= 300));
  end if;
end $$;

-- تطبيع النصوص الجديدة (الفراغ → null) مع إبقاء فحص المنطقة الزمنية.
create or replace function public.wedding_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.groom_name    := public.normalize_single_line(new.groom_name);
  new.bride_name    := public.normalize_single_line(new.bride_name);
  new.venue_name    := public.normalize_single_line(new.venue_name);
  new.venue_address := public.normalize_single_line(new.venue_address);
  new.maps_url      := public.normalize_single_line(new.maps_url);
  new.timezone      := btrim(new.timezone);

  new.verse_text          := public.normalize_multiline(new.verse_text);
  new.intro_line          := public.normalize_single_line(new.intro_line);
  new.tagline             := public.normalize_single_line(new.tagline);
  new.invitation_message  := public.normalize_multiline(new.invitation_message);
  new.details_title       := public.normalize_single_line(new.details_title);
  new.countdown_title     := public.normalize_single_line(new.countdown_title);
  new.countdown_done_text := public.normalize_single_line(new.countdown_done_text);
  new.actions_title       := public.normalize_single_line(new.actions_title);
  new.rsvp_title          := public.normalize_single_line(new.rsvp_title);
  new.rsvp_lead           := public.normalize_single_line(new.rsvp_lead);
  new.footer_text         := public.normalize_single_line(new.footer_text);
  new.children_note_title := public.normalize_single_line(new.children_note_title);
  new.children_note_body  := public.normalize_multiline(new.children_note_body);
  new.share_closing_text  := public.normalize_multiline(new.share_closing_text);
  new.whatsapp_number     := nullif(regexp_replace(coalesce(new.whatsapp_number, ''), '[^0-9]', '', 'g'), '');
  new.site_url            := public.normalize_single_line(new.site_url);

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- صلاحية المدير لتعديل الأعمدة الجديدة (RLS تبقى: is_admin() فقط).
grant update (verse_text, intro_line, tagline, invitation_message, details_title, countdown_title,
              countdown_done_text, actions_title, rsvp_title, rsvp_lead, footer_text,
              show_children_note, children_note_title, children_note_body,
              share_closing_text, whatsapp_number, site_url)
  on public.wedding_settings to authenticated;

-- الإعدادات العامة المعروضة في صفحة الدعوة (بدون أي بيانات مدعوين).
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
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or now() < s.rsvp_deadline),
    'verse_text', s.verse_text,
    'intro_line', s.intro_line,
    'tagline', s.tagline,
    'invitation_message', s.invitation_message,
    'details_title', s.details_title,
    'countdown_title', s.countdown_title,
    'countdown_done_text', s.countdown_done_text,
    'actions_title', s.actions_title,
    'rsvp_title', s.rsvp_title,
    'rsvp_lead', s.rsvp_lead,
    'footer_text', s.footer_text,
    'show_children_note', s.show_children_note,
    'children_note_title', s.children_note_title,
    'children_note_body', s.children_note_body,
    'share_closing_text', s.share_closing_text,
    'whatsapp_number', s.whatsapp_number,
    'site_url', s.site_url
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
grant execute on function public.rsvp_public_settings() to service_role;


-- >>>>>>>>>> 008_experience_settings.sql
-- =============================================================================
-- 008_experience_settings.sql
-- إعدادات التجربة التفاعلية: فتح الظرف ثلاثي الأبعاد، المؤثرات الحية، والموسيقى.
-- كلها قابلة للتعديل من لوحة الإدارة. آمن لإعادة التشغيل.
-- =============================================================================

alter table public.wedding_settings
  add column if not exists intro_enabled   boolean not null default true,  -- مشهد الظرف عند الفتح
  add column if not exists effects_enabled boolean not null default true,  -- الغبار الذهبي والأوراق المتساقطة والإمالة ثلاثية الأبعاد
  add column if not exists music_enabled   boolean not null default true,  -- موسيقى خلفية بعد فتح الظرف (يمكن للضيف كتمها)
  add column if not exists music_url       text;                          -- ملف موسيقى خاص (https) — فارغ = لحن هادئ يُولَّد داخل المتصفح

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_music_url') then
    alter table public.wedding_settings add constraint wedding_settings_music_url
      check (music_url is null or (music_url ~ '^https://' and char_length(music_url) <= 500));
  end if;
end $$;

grant update (intro_enabled, effects_enabled, music_enabled, music_url) on public.wedding_settings to authenticated;

-- إعادة تعريف الإعدادات العامة لتشمل خيارات التجربة.
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
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or now() < s.rsvp_deadline),
    'verse_text', s.verse_text,
    'intro_line', s.intro_line,
    'tagline', s.tagline,
    'invitation_message', s.invitation_message,
    'details_title', s.details_title,
    'countdown_title', s.countdown_title,
    'countdown_done_text', s.countdown_done_text,
    'actions_title', s.actions_title,
    'rsvp_title', s.rsvp_title,
    'rsvp_lead', s.rsvp_lead,
    'footer_text', s.footer_text,
    'show_children_note', s.show_children_note,
    'children_note_title', s.children_note_title,
    'children_note_body', s.children_note_body,
    'share_closing_text', s.share_closing_text,
    'whatsapp_number', s.whatsapp_number,
    'site_url', s.site_url,
    'intro_enabled', s.intro_enabled,
    'effects_enabled', s.effects_enabled,
    'music_enabled', s.music_enabled,
    'music_url', s.music_url
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
grant execute on function public.rsvp_public_settings() to service_role;


-- >>>>>>>>>> 009_theme.sql
-- =============================================================================
-- 009_theme.sql
-- الهوية اللونية للدعوة (تُختار من لوحة الإدارة). آمن لإعادة التشغيل.
-- القيم يجب أن تطابق js/theme.js و css/themes.css.
-- =============================================================================

alter table public.wedding_settings
  add column if not exists theme text not null default 'emerald';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_theme') then
    alter table public.wedding_settings add constraint wedding_settings_theme
      check (theme in ('emerald', 'navy', 'rose-gold', 'burgundy', 'noir', 'olive', 'royal'));
  end if;
end $$;

grant update (theme) on public.wedding_settings to authenticated;

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
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or now() < s.rsvp_deadline),
    'verse_text', s.verse_text,
    'intro_line', s.intro_line,
    'tagline', s.tagline,
    'invitation_message', s.invitation_message,
    'details_title', s.details_title,
    'countdown_title', s.countdown_title,
    'countdown_done_text', s.countdown_done_text,
    'actions_title', s.actions_title,
    'rsvp_title', s.rsvp_title,
    'rsvp_lead', s.rsvp_lead,
    'footer_text', s.footer_text,
    'show_children_note', s.show_children_note,
    'children_note_title', s.children_note_title,
    'children_note_body', s.children_note_body,
    'share_closing_text', s.share_closing_text,
    'whatsapp_number', s.whatsapp_number,
    'site_url', s.site_url,
    'intro_enabled', s.intro_enabled,
    'effects_enabled', s.effects_enabled,
    'music_enabled', s.music_enabled,
    'music_url', s.music_url,
    'theme', s.theme
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
grant execute on function public.rsvp_public_settings() to service_role;


-- >>>>>>>>>> التحقق النهائي: يجب أن تظهر نتيجة واحدة فيها tables_found = 6
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('wedding_settings','invitations','rsvp_responses','admin_audit_logs','admin_users','rsvp_rate_limits')) as tables_found,
  (select groom_name || ' & ' || bride_name || ' | ' || venue_address || ' | ' || theme from public.wedding_settings) as settings,
  (select count(*) from public.admin_users) as admins;
