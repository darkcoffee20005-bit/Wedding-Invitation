-- =============================================================================
-- database_tests.sql — اختبارات القيود و RLS والصلاحيات ومسار RSVP وسجل التدقيق.
-- يُشغَّل عبر scripts/test-db.sh على قاعدة PostgreSQL محلية بعد ملف المحاكاة والترحيلات.
-- أي فشل يرفع استثناء ويوقف التنفيذ (ON_ERROR_STOP).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

-- ---------- إعداد: مستخدمان (مدير وغير مدير) ----------
reset role;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'user@test.local');
insert into public.admin_users (user_id) values ('11111111-1111-1111-1111-111111111111');

create or replace function pg_temp.expect_error(p_sql text, p_expected text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like '%' || p_expected || '%' or sqlstate = p_expected then
      raise notice 'PASS: %', p_label;
      return;
    end if;
    raise exception 'FAIL: % — unexpected error: % (%)', p_label, sqlerrm, sqlstate;
  end;
  raise exception 'FAIL: % — expected error "%" but statement succeeded', p_label, p_expected;
end $$;

create or replace function pg_temp.check(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end $$;

grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated, service_role;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;

-- ---------- 1) قيود الجدول (كمالك القاعدة) ----------
select pg_temp.check((select count(*) = 1 from public.wedding_settings), 'seed: wedding settings row exists');
select pg_temp.check((select groom_name = 'يوسف' and bride_name = 'شذى' and event_date = '2027-05-27'
                      and event_time = '16:00' and timezone = 'Asia/Baghdad' from public.wedding_settings),
                     'seed: wedding data matches');
select pg_temp.check((select to_char(event_date, 'FMDay') = 'Thursday' from public.wedding_settings), 'seed: 2027-05-27 is Thursday');
select pg_temp.check((select (rsvp_public_settings() ->> 'starts_at')::timestamptz = '2027-05-27 13:00:00+00'),
                     'starts_at = 16:00 Asia/Baghdad = 13:00 UTC');
select pg_temp.check((select count(*) = 0 from public.rsvp_responses), 'no fake/demo responses seeded');

select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('   ', 'attending', 1)$q$, '23502', 'constraint: blank name rejected (normalized to null)');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('أحمد', 'maybe', 1)$q$, '23514', 'constraint: unknown attendance rejected');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('أحمد', 'attending', 0)$q$, '23514', 'constraint: attending with 0 rejected');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('أحمد', 'attending', -2)$q$, '23514', 'constraint: negative count rejected');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('أحمد', 'declined', 2)$q$, '23514', 'constraint: declined with non-zero rejected');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('أحمد', 'attending', 6)$q$, 'guest_count_exceeds_limit', 'trigger: count above settings limit (5) rejected');
select pg_temp.expect_error($q$update public.wedding_settings set timezone = 'Mars/Olympus' where id = 1$q$, 'invalid_timezone', 'settings: invalid timezone rejected');
select pg_temp.expect_error($q$update public.wedding_settings set max_guests_per_response = 0 where id = 1$q$, '23514', 'settings: max guests 0 rejected');
select pg_temp.expect_error($q$insert into public.wedding_settings (id, groom_name, bride_name, event_date, event_time, venue_name, venue_address) values (2,'a','b','2027-01-01','10:00','x','y')$q$, '23514', 'settings: only one row allowed');

-- نصوص الصفحة القابلة للتعديل (007)
select pg_temp.check((select children_note_body = E'نعتذر منكم بكل محبة، ونرجو من ضيوفنا الكرام عدم اصطحاب الأطفال إلى الحفل، حيث إن الدعوة مخصصة للكبار فقط.\nشاكرين لكم تفهّمكم وتعاونكم، ونتطلع إلى مشاركتكم فرحتنا بأجمل الأوقات.'
                      and children_note_title = 'ملاحظة مهمة لضيوفنا الكرام' and show_children_note and rsvp_title = 'هل ستشاركوننا فرحتنا؟'
                      from public.wedding_settings), 'content: defaults include verbatim children note');
select pg_temp.check((select (public.rsvp_public_settings() ->> 'children_note_title') = 'ملاحظة مهمة لضيوفنا الكرام'
                      and (public.rsvp_public_settings() ? 'verse_text') and (public.rsvp_public_settings() ? 'site_url')), 'content: public settings expose page texts');
select pg_temp.expect_error($q$update public.wedding_settings set rsvp_title = '   ' where id = 1$q$, '23502', 'content: required title cannot be blank');
select pg_temp.expect_error($q$update public.wedding_settings set whatsapp_number = '12' where id = 1$q$, '23514', 'content: short WhatsApp number rejected');
select pg_temp.expect_error($q$update public.wedding_settings set site_url = 'http://x.example' where id = 1$q$, '23514', 'content: non-https site url rejected');
select pg_temp.expect_error($q$update public.wedding_settings set show_children_note = true, children_note_body = '' where id = 1$q$, '23514', 'content: shown children note needs body');
select pg_temp.expect_error($q$update public.wedding_settings set verse_text = repeat('x', 401) where id = 1$q$, '23514', 'content: verse length limit');
update public.wedding_settings set whatsapp_number = '+964 770 123 4567', tagline = '  نص   جديد  ' where id = 1;
select pg_temp.check((select whatsapp_number = '9647701234567' and tagline = 'نص جديد' from public.wedding_settings), 'content: whatsapp digits & text normalized');
update public.wedding_settings set whatsapp_number = null, tagline = default where id = 1;

-- ---------- 2) الزائر المجهول anon: لا شيء ----------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null
select pg_temp.expect_error('select * from public.rsvp_responses', '42501', 'anon cannot read responses');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count) values ('x y', 'attending', 1)$q$, '42501', 'anon cannot insert responses directly');
select pg_temp.expect_error('delete from public.rsvp_responses', '42501', 'anon cannot delete responses');
select pg_temp.expect_error($q$update public.rsvp_responses set guest_count = 1$q$, '42501', 'anon cannot update responses');
select pg_temp.expect_error('select * from public.wedding_settings', '42501', 'anon cannot read settings table');
select pg_temp.expect_error($q$update public.wedding_settings set groom_name = 'x'$q$, '42501', 'anon cannot modify settings');
select pg_temp.expect_error('select * from public.invitations', '42501', 'anon cannot read invitations');
select pg_temp.expect_error('select * from public.admin_audit_logs', '42501', 'anon cannot read audit logs');
select pg_temp.expect_error('select * from public.admin_users', '42501', 'anon cannot read admin_users');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 1, null)$q$, '42501', 'anon cannot call rsvp_submit RPC directly');
select pg_temp.expect_error($q$select public.rsvp_get_context(null, null)$q$, '42501', 'anon cannot call rsvp_get_context RPC directly');
select pg_temp.expect_error('select public.admin_dashboard_stats()', '42501', 'anon cannot call admin stats');
select pg_temp.expect_error($q$select public.admin_create_invitation('x')$q$, '42501', 'anon cannot create invitations');
reset role;

-- ---------- 3) مسار RSVP العام (service_role كما تستدعيه الـ Edge Function) ----------
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null

create temp table t_tokens (k text primary key, v text);
grant all on t_tokens to public;

do $$
declare r jsonb;
begin
  r := public.rsvp_submit(null, null, '00000000-0000-4000-8000-000000000001', '  سارة   محمد  ', 'attending', 3, '  ألف مبروك!  ');
  perform pg_temp.check(r ->> 'mode' = 'created', 'rsvp: valid attending (open) created');
  perform pg_temp.check(r -> 'response' ->> 'guest_name' = 'سارة محمد', 'rsvp: name whitespace normalized');
  perform pg_temp.check(r -> 'response' ->> 'message' = 'ألف مبروك!', 'rsvp: message trimmed');
  perform pg_temp.check((r ->> 'edit_token') ~ '^[A-Za-z0-9_-]{32}$', 'rsvp: strong edit token returned once');
  insert into t_tokens values ('edit1', r ->> 'edit_token');

  -- إعادة نفس الطلب (نفس request_id) لا تنشئ صفًا جديدًا
  r := public.rsvp_submit(null, null, '00000000-0000-4000-8000-000000000001', 'سارة محمد', 'attending', 3, 'ألف مبروك!');
  perform pg_temp.check(r ->> 'mode' = 'updated', 'rsvp: retry with same request id updates, not duplicates');
  update t_tokens set v = r ->> 'edit_token' where k = 'edit1';

  r := public.rsvp_submit(null, null, '00000000-0000-4000-8000-000000000002', 'خالد حسن', 'declined', 4, null);
  perform pg_temp.check((r -> 'response' ->> 'guest_count')::int = 0, 'rsvp: declined saved with guest_count = 0');
  perform pg_temp.check(r -> 'response' ->> 'attendance' = 'declined', 'rsvp: valid decline saved');
end $$;

select pg_temp.check((select count(*) = 2 from public.rsvp_responses), 'rsvp: exactly 2 rows after retry (no duplicate)');

select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), '   ', 'attending', 1, null)$q$, 'rsvp:invalid_name', 'rsvp: empty name rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'ا', 'attending', 1, null)$q$, 'rsvp:invalid_name', 'rsvp: 1-char name rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), repeat('ب', 81), 'attending', 1, null)$q$, 'rsvp:invalid_name', 'rsvp: name > 80 rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 0, null)$q$, 'rsvp:invalid_guest_count', 'rsvp: attending with 0 rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', -1, null)$q$, 'rsvp:invalid_guest_count', 'rsvp: negative count rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', null, null)$q$, 'rsvp:invalid_guest_count', 'rsvp: missing count rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 6, null)$q$, 'rsvp:guest_count_exceeds_limit', 'rsvp: count above limit rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'maybe', 1, null)$q$, 'rsvp:invalid_attendance', 'rsvp: unknown attendance rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 1, repeat('x', 501))$q$, 'rsvp:invalid_message', 'rsvp: message > 500 rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, null, 'أحمد علي', 'attending', 1, null)$q$, 'rsvp:invalid_request', 'rsvp: open submit without request id rejected');
select pg_temp.expect_error($q$select public.rsvp_submit(null, 'not-a-real-token-not-a-real-tok', null, 'أحمد علي', 'attending', 1, null)$q$, 'rsvp:invalid_edit_token', 'rsvp: forged edit token rejected');

do $$
declare r jsonb; v_tok text := (select v from t_tokens where k = 'edit1');
begin
  r := public.rsvp_submit(null, v_tok, null, 'سارة محمد', 'attending', 2, 'تعديل');
  perform pg_temp.check(r ->> 'mode' = 'updated' and (r -> 'response' ->> 'guest_count')::int = 2, 'rsvp: edit via edit token updates own response');
  r := public.rsvp_get_context(null, v_tok);
  perform pg_temp.check(r ->> 'edit_token' = 'valid' and r -> 'response' ->> 'guest_name' = 'سارة محمد', 'context: edit token returns only own response');
  r := public.rsvp_get_context(null, null);
  perform pg_temp.check(r -> 'response' = 'null'::jsonb and r -> 'settings' ->> 'venue_name' = 'مزرعة الفرح', 'context: no token → settings only, no guest data');
end $$;

reset role;

-- ---------- 4) المستخدم المسجل غير المدير ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false) \g /dev/null
select pg_temp.check((select count(*) = 0 from public.rsvp_responses), 'non-admin: sees 0 responses (RLS)');
select pg_temp.check((select count(*) = 0 from public.wedding_settings), 'non-admin: sees 0 settings rows (RLS)');
do $$ declare n int; begin
  update public.rsvp_responses set guest_count = 1 where attendance = 'attending'; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'non-admin: update affects 0 rows');
  delete from public.rsvp_responses; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'non-admin: delete affects 0 rows');
  update public.wedding_settings set groom_name = 'x', verse_text = 'x'; get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'non-admin: cannot change settings');
end $$;
select pg_temp.expect_error('select public.admin_dashboard_stats()', 'forbidden', 'non-admin: stats forbidden');
select pg_temp.expect_error($q$select public.admin_create_invitation('عائلة')$q$, 'forbidden', 'non-admin: create invitation forbidden');
select pg_temp.expect_error($q$insert into public.rsvp_responses (guest_name, attendance, guest_count, source) values ('مزيف مزيف', 'attending', 1, 'admin')$q$, '42501', 'non-admin: manual insert blocked by RLS');
select pg_temp.expect_error($q$insert into public.admin_users (user_id) values ('22222222-2222-2222-2222-222222222222')$q$, '42501', 'non-admin: cannot self-promote to admin');
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 1, null)$q$, '42501', 'authenticated cannot call rsvp_submit directly');
select pg_temp.check(public.is_admin() = false, 'non-admin: is_admin() = false');
reset role;

-- ---------- 5) المدير ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) \g /dev/null
select pg_temp.check(public.is_admin(), 'admin: is_admin() = true');
select pg_temp.check((select count(*) = 2 from public.rsvp_responses), 'admin: reads all responses');

do $$
declare s jsonb; inv jsonb; inv2 jsonb;
begin
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'total_responses')::int = 2, 'stats: total responses = 2');
  perform pg_temp.check((s ->> 'attending_responses')::int = 1, 'stats: attending = 1');
  perform pg_temp.check((s ->> 'declined_responses')::int = 1, 'stats: declined = 1');
  perform pg_temp.check((s ->> 'expected_guests')::int = 2, 'stats: expected guests = sum of attending only (2)');
  perform pg_temp.check((s ->> 'average_guests_per_attending')::numeric = 2.00, 'stats: average = 2.00');
  perform pg_temp.check(s -> 'invitations_pending' = 'null'::jsonb, 'stats: pending is null without invitation list');

  inv := public.admin_create_invitation('عائلة الأستاذ كريم', 8, 'أقارب');
  perform pg_temp.check((inv ->> 'token') ~ '^[A-Za-z0-9_-]{32}$', 'admin: invitation created with strong token');
  insert into t_tokens values ('inv1', inv ->> 'token'), ('inv1_id', inv ->> 'id');
  inv2 := public.admin_create_invitation('ليلى', null, null);
  insert into t_tokens values ('inv2', inv2 ->> 'token'), ('inv2_id', inv2 ->> 'id');

  perform pg_temp.check((select token_hash <> convert_to(inv ->> 'token', 'UTF8') from public.invitations where id = (inv ->> 'id')::uuid),
                        'invitation: plaintext token not stored');
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'invitations_pending')::int = 2, 'stats: 2 pending invitations');
end $$;
reset role;

-- دعوات شخصية عبر المسار العام
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
do $$
declare r jsonb; t1 text := (select v from t_tokens where k = 'inv1'); t2 text := (select v from t_tokens where k = 'inv2');
begin
  r := public.rsvp_get_context(t1, null);
  perform pg_temp.check(r -> 'invitation' ->> 'status' = 'valid' and (r -> 'invitation' ->> 'max_guests')::int = 8, 'context: valid invitation with per-invite max 8');
  perform pg_temp.check(r -> 'response' = 'null'::jsonb, 'context: no response yet');

  r := public.rsvp_submit(t1, null, null, 'كريم جاسم', 'attending', 7, 'مبارك');
  perform pg_temp.check(r ->> 'mode' = 'created' and r -> 'edit_token' = 'null'::jsonb, 'invite: created (7 allowed by per-invite max)');
  r := public.rsvp_submit(t1, null, null, 'كريم جاسم', 'declined', 7, null);
  perform pg_temp.check(r ->> 'mode' = 'updated' and (r -> 'response' ->> 'guest_count')::int = 0, 'invite: same link updates the single response');
  perform pg_temp.check((select count(*) = 1 from public.rsvp_responses where invitation_id = (select v from t_tokens where k = 'inv1_id')::uuid),
                        'invite: exactly one response per invitation');
  r := public.rsvp_submit(t1, null, null, 'كريم جاسم', 'attending', 4, null);

  r := public.rsvp_get_context(t2, null);
  perform pg_temp.check((r -> 'invitation' ->> 'max_guests')::int = 5, 'context: invite without override uses global max 5');
  r := public.rsvp_get_context('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', null);
  perform pg_temp.check(r -> 'invitation' ->> 'status' = 'invalid' and r -> 'response' = 'null'::jsonb, 'context: unknown token → invalid, no data');
end $$;
select pg_temp.expect_error($q$select public.rsvp_submit((select v from t_tokens where k='inv2'), null, null, 'ليلى سمير', 'attending', 6, null)$q$, 'rsvp:guest_count_exceeds_limit', 'invite: count above invite limit rejected');
select pg_temp.expect_error($q$select public.rsvp_submit('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', null, null, 'ليلى سمير', 'attending', 1, null)$q$, 'rsvp:invalid_invitation', 'invite: forged token rejected');
reset role;

-- المدير: تعديل، حذف، إلغاء دعوة، تجديد الرابط، وتحديث الإحصائيات
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) \g /dev/null
do $$
declare s jsonb; n int; v_id uuid; inv jsonb;
begin
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'total_responses')::int = 3 and (s ->> 'expected_guests')::int = 6 and (s ->> 'invitations_pending')::int = 1,
                        'stats: total 3, expected 6 (2+4), pending invitations 1');

  select id into v_id from public.rsvp_responses where guest_name = 'سارة محمد';
  update public.rsvp_responses set guest_count = 5 where id = v_id;
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'expected_guests')::int = 9, 'stats: updated after admin edit (9)');

  update public.rsvp_responses set attendance = 'declined', guest_count = 0 where id = v_id;
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'expected_guests')::int = 4 and (s ->> 'declined_responses')::int = 2, 'stats: decline excluded from expected guests');

  delete from public.rsvp_responses where id = v_id; get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'admin: delete works');
  s := public.admin_dashboard_stats();
  perform pg_temp.check((s ->> 'total_responses')::int = 2, 'stats: updated after delete');

  insert into public.rsvp_responses (guest_name, attendance, guest_count, message, source) values ('رد هاتفي', 'attending', 2, null, 'admin');
  perform pg_temp.check((select count(*) = 3 from public.rsvp_responses), 'admin: manual response insert works');

  update public.invitations set revoked_at = now() where id = (select v from t_tokens where k = 'inv2_id')::uuid;
  update public.wedding_settings set max_guests_per_response = 6 where id = 1;
  update public.wedding_settings set rsvp_title = 'تأكيد الحضور', show_children_note = false where id = 1;
  perform pg_temp.check((select rsvp_title = 'تأكيد الحضور' and not show_children_note from public.wedding_settings), 'admin: can edit page texts and toggles');

  perform pg_temp.check((select count(*) from public.admin_audit_logs where action = 'rsvp_update') = 2, 'audit: admin updates logged');
  perform pg_temp.check((select count(*) from public.admin_audit_logs where action = 'rsvp_delete') = 1, 'audit: admin delete logged');
  perform pg_temp.check((select count(*) from public.admin_audit_logs where action = 'invitation_create') = 2, 'audit: invitation creation logged');
  perform pg_temp.check((select count(*) from public.admin_audit_logs where action = 'settings_update') = 2, 'audit: settings updates logged');
  perform pg_temp.check((select bool_and(admin_id = '11111111-1111-1111-1111-111111111111') from public.admin_audit_logs), 'audit: admin id recorded');
  perform pg_temp.check(not exists (select 1 from public.admin_audit_logs where summary ~ '[A-Za-z0-9_-]{32}'), 'audit: no tokens in summaries');

  inv := public.admin_regenerate_invitation_token((select v from t_tokens where k = 'inv2_id')::uuid);
  insert into t_tokens values ('inv2_new', inv ->> 'token');
  perform pg_temp.check((select count(*) from public.admin_audit_logs where action = 'invitation_token_regenerate') = 1, 'audit: token regeneration logged');
end $$;
select pg_temp.expect_error('delete from public.admin_audit_logs', '42501', 'audit: admin cannot delete logs');
select pg_temp.expect_error($q$update public.admin_audit_logs set summary = 'x'$q$, '42501', 'audit: admin cannot update logs');
select pg_temp.expect_error($q$insert into public.admin_audit_logs (action, target_table) values ('rsvp_update', 'x')$q$, '42501', 'audit: admin cannot forge log rows');
select pg_temp.expect_error($q$update public.rsvp_responses set edit_token_hash = null$q$, '42501', 'admin: cannot touch edit_token_hash column');
select pg_temp.expect_error($q$update public.invitations set token_hash = '\x00'$q$, '42501', 'admin: cannot set token_hash directly');
reset role;
select pg_temp.expect_error('delete from public.admin_audit_logs', 'append-only', 'audit: even table owner delete blocked by trigger');

set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
select pg_temp.expect_error($q$select public.rsvp_submit((select v from t_tokens where k='inv2'), null, null, 'ليلى سمير', 'attending', 1, null)$q$, 'rsvp:invalid_invitation', 'invite: old link invalid after regeneration');
do $$ declare r jsonb; begin
  r := public.rsvp_submit((select v from t_tokens where k = 'inv2_new'), null, null, 'ليلى سمير', 'attending', 6, null);
  perform pg_temp.check(r ->> 'mode' = 'created', 'invite: new link works & raised global limit (6) applies');
end $$;
reset role;

-- ---------- 6) إغلاق الردود / إلزام الدعوات / تحديد المعدل ----------
update public.wedding_settings set allow_open_rsvp = false where id = 1;
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 1, null)$q$, 'rsvp:invitation_required', 'settings: open RSVP disabled → invitation required');
reset role;
update public.wedding_settings set rsvp_deadline = now() - interval '1 minute', allow_open_rsvp = true where id = 1;
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
select pg_temp.expect_error($q$select public.rsvp_submit(null, null, gen_random_uuid(), 'أحمد علي', 'attending', 1, null)$q$, 'rsvp:closed', 'settings: past deadline → closed');
select pg_temp.check((public.rsvp_get_context(null, null) -> 'settings' ->> 'rsvp_open')::boolean = false, 'context: rsvp_open false after deadline');
do $$ declare i int; ok boolean;
begin
  for i in 1..3 loop
    ok := public.rsvp_consume_rate_limit('submit:test-client-key', 3, 600);
    perform pg_temp.check(ok, format('rate limit: request %s allowed', i));
  end loop;
  ok := public.rsvp_consume_rate_limit('submit:test-client-key', 3, 600);
  perform pg_temp.check(not ok, 'rate limit: 4th request blocked');
  ok := public.rsvp_consume_rate_limit('submit:other-client-key', 3, 600);
  perform pg_temp.check(ok, 'rate limit: other client unaffected');
end $$;
reset role;
select pg_temp.check(not exists (select 1 from public.rsvp_rate_limits where position(convert_to('test-client', 'UTF8') in key_hash) > 0),
                     'rate limit: client key stored only as hash');
update public.wedding_settings set rsvp_deadline = null, max_guests_per_response = 5, rsvp_title = default, show_children_note = true where id = 1;

\echo 'ALL DATABASE TESTS PASSED'
