-- =============================================================================
-- create_first_admin.sql
-- يُنفَّذ يدويًا مرة واحدة من Supabase Dashboard → SQL Editor
-- بعد إنشاء المستخدم من Authentication → Users → Add user (مع Auto Confirm).
--
-- 1) استبدل البريد أدناه ببريد المدير الذي أنشأته (لا تحفظ هذا الملف بعد التعديل في Git).
-- 2) نفّذ الملف. سيفشل برسالة واضحة إن لم يوجد المستخدم.
-- =============================================================================
do $$
declare
  v_email text := 'REPLACE_WITH_ADMIN_EMAIL@example.com';
  v_user  uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'لا يوجد مستخدم بهذا البريد في auth.users: %', v_email;
  end if;

  insert into public.admin_users (user_id, note)
  values (v_user, 'المدير الأول')
  on conflict (user_id) do nothing;

  raise notice 'تمت إضافة % إلى قائمة المدراء', v_email;
end;
$$;

-- لسحب صلاحية مدير:
-- delete from public.admin_users where user_id = (select id from auth.users where email = '...');
