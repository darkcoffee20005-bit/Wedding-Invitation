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
