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
