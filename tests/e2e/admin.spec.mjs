// اختبارات لوحة الإدارة عبر PostgREST الحقيقي و RLS الحقيقية (المصادقة محاكاة محليًا).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resetData, sql, sqlJson, useLocalSupabase, GATEWAY } from './helpers.mjs';
import { TEST_ANON_KEY } from '../support/jwt.mjs';

const ADMIN = { email: 'admin@test.local', password: 'Admin-Test-Pass-1' };
const USER = { email: 'user@test.local', password: 'User-Test-Pass-1' };

function seedResponses() {
  sql(`insert into public.rsvp_responses (guest_name, attendance, guest_count, message, source, created_at) values
    ('أحمد علي', 'attending', 3, 'مبروك', 'open', now() - interval '3 days'),
    ('بسمة حسن', 'attending', 2, null, 'open', now() - interval '2 days'),
    ('جمال كاظم', 'declined', 0, 'اعتذر بحب', 'open', now() - interval '2 days'),
    ('دينا صالح', 'attending', 1, '=HYPERLINK("http://evil","x")', 'open', now() - interval '1 day'),
    ('هادي يوسف', 'declined', 0, null, 'open', now());`);
}

async function login(page, { email, password }) {
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
}

async function statValue(page, key) {
  return (await page.locator(`[data-stat="${key}"]`).first().textContent()).trim();
}

test.beforeEach(async ({ page }) => {
  resetData();
  await useLocalSupabase(page);
});

test('بدون تسجيل دخول: تظهر صفحة الدخول فقط ولا بيانات', async ({ page }) => {
  seedResponses();
  await page.goto('/admin/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('أحمد علي');
  await expect(page.getByRole('button', { name: /إنشاء حساب|تسجيل جديد|sign up/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /إنشاء حساب|تسجيل جديد|sign up/i })).toHaveCount(0);
});

test('كلمة مرور خاطئة: رسالة خطأ', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, { email: ADMIN.email, password: 'wrong-password' });
  await expect(page.locator('#login-error')).toHaveText('بيانات الدخول غير صحيحة.');
  await expect(page.locator('#view-dashboard')).toBeHidden();
});

test('مستخدم مسجّل غير مدير: مرفوض، و RLS تمنعه حتى عبر الطلبات اليدوية', async ({ page }) => {
  seedResponses();
  await page.goto('/admin/');
  await login(page, USER);
  await expect(page.locator('#view-forbidden')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toBeHidden();

  // محاولة تجاوز الواجهة بطلبات يدوية بنفس رمز المستخدم
  const tokenRes = await page.request.post(`${GATEWAY}/auth/v1/token?grant_type=password`, { data: USER });
  const { access_token } = await tokenRes.json();
  const headers = { apikey: TEST_ANON_KEY, Authorization: `Bearer ${access_token}` };
  const list = await page.request.get(`${GATEWAY}/rest/v1/rsvp_responses?select=*`, { headers });
  expect(await list.json()).toEqual([]);
  const del = await page.request.delete(`${GATEWAY}/rest/v1/rsvp_responses?id=not.is.null`, { headers: { ...headers, Prefer: 'return=representation' } });
  expect(await del.json()).toEqual([]);
  const stats = await page.request.post(`${GATEWAY}/rest/v1/rpc/admin_dashboard_stats`, { headers, data: {} });
  expect(stats.status()).toBe(403);
  const promote = await page.request.post(`${GATEWAY}/rest/v1/admin_users`, { headers, data: { user_id: '22222222-2222-2222-2222-222222222222' } });
  expect([401, 403]).toContain(promote.status());
  expect(sqlJson('select id from rsvp_responses')).toHaveLength(5);
});

test('الزائر المجهول لا يستطيع قراءة أو تعديل الردود عبر API', async ({ page }) => {
  seedResponses();
  const headers = { apikey: TEST_ANON_KEY, Authorization: `Bearer ${TEST_ANON_KEY}` };
  const read = await page.request.get(`${GATEWAY}/rest/v1/rsvp_responses?select=*`, { headers });
  expect(read.status()).toBe(401);
  const ins = await page.request.post(`${GATEWAY}/rest/v1/rsvp_responses`, { headers, data: { guest_name: 'x y', attendance: 'attending', guest_count: 1 } });
  expect(ins.status()).toBe(401);
  const settings = await page.request.patch(`${GATEWAY}/rest/v1/wedding_settings?id=eq.1`, { headers, data: { groom_name: 'x' } });
  expect(settings.status()).toBe(401);
  expect(sqlJson(`select groom_name from wedding_settings`)).toEqual([{ groom_name: 'يوسف' }]);
});

test('قاعدة بيانات فارغة: حالة فارغة واضحة وأصفار حقيقية', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#view-dashboard')).toBeVisible();
  await expect(page.locator('[data-stat="total_responses"]')).toHaveText('0');
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText('0');
  await expect(page.locator('[data-stat="average_guests_per_attending"]')).toHaveText('—');
  await expect(page.locator('#stat-pending')).toBeHidden();
  await expect(page.locator('#responses-empty')).toContainText('لا توجد ردود مسجلة بعد');
  await expect(page.locator('#chart-split')).toContainText('لا توجد ردود بعد');
  await expect(page.locator('#chart-timeline')).toContainText('لا توجد ردود بعد');
});

test('الإحصائيات والجدول مطابقة لقاعدة البيانات، مع البحث والتصفية والترتيب', async ({ page }) => {
  seedResponses();
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#view-dashboard')).toBeVisible();

  const db = sqlJson(`select count(*)::int total,
      count(*) filter (where attendance='attending')::int attending,
      count(*) filter (where attendance='declined')::int declined,
      coalesce(sum(guest_count) filter (where attendance='attending'),0)::int expected
    from rsvp_responses`)[0];
  await expect(page.locator('[data-stat="total_responses"]')).toHaveText(String(db.total));          // 5 ردود
  await expect(page.locator('[data-stat="attending_responses"]')).toHaveText(String(db.attending));  // 3
  await expect(page.locator('[data-stat="declined_responses"]')).toHaveText(String(db.declined));    // 2
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText(String(db.expected));       // 6 أشخاص
  expect(db).toEqual({ total: 5, attending: 3, declined: 2, expected: 6 });
  await expect(page.locator('[data-stat="average_guests_per_attending"]')).toHaveText('2');
  await expect(page.locator('#responses-body tr')).toHaveCount(5);
  await expect(page.locator('#chart-split svg')).toBeVisible();
  await expect(page.locator('#chart-timeline svg')).toBeVisible();
  await expect(page.locator('#chart-guests svg')).toBeVisible();

  await page.fill('#search-input', 'بسمة');
  await expect(page.locator('#responses-body tr')).toHaveCount(1);
  await expect(page.locator('#responses-body')).toContainText('بسمة حسن');
  await page.fill('#search-input', '');
  await expect(page.locator('#responses-body tr')).toHaveCount(5);

  await page.selectOption('#filter-select', 'declined');
  await expect(page.locator('#responses-body tr')).toHaveCount(2);
  await page.selectOption('#filter-select', '');

  await page.selectOption('#sort-select', 'guest_count.desc');
  await expect(page.locator('#responses-body tr').first()).toContainText('أحمد علي');
  await page.selectOption('#sort-select', 'created_at.asc');
  await expect(page.locator('#responses-body tr').first()).toContainText('أحمد علي');
  await page.selectOption('#sort-select', 'created_at.desc');
  await expect(page.locator('#responses-body tr').first()).toContainText('هادي يوسف');

  await page.locator('#responses-body tr', { hasText: 'أحمد علي' }).getByRole('button', { name: /تفاصيل/ }).click();
  await expect(page.locator('#details-dialog')).toContainText('مبروك');
  await page.locator('#details-dialog [data-close]').click();
});

test('تقسيم الصفحات', async ({ page }) => {
  sql(`insert into public.rsvp_responses (guest_name, attendance, guest_count, source)
       select 'ضيف رقم ' || g, 'attending', 1, 'open' from generate_series(1, 25) g;`);
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#responses-body tr')).toHaveCount(20);
  await expect(page.locator('#page-info')).toContainText('من 25');
  await page.click('#next-page');
  await expect(page.locator('#responses-body tr')).toHaveCount(5);
  await expect(page.locator('#next-page')).toBeDisabled();
  await page.click('#prev-page');
  await expect(page.locator('#responses-body tr')).toHaveCount(20);
});

test('تعديل وحذف وإضافة رد تحدّث الإحصائيات وتُسجَّل في سجل التدقيق', async ({ page }) => {
  seedResponses();
  const auditBaseline = Number(sql('select coalesce(max(id), 0) from admin_audit_logs;'));
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText('6');

  // تعديل: أحمد من 3 إلى 5
  await page.locator('#responses-body tr', { hasText: 'أحمد علي' }).getByRole('button', { name: /تعديل/ }).click();
  await page.fill('#edit-form input[name="guest_count"]', '5');
  await page.click('#edit-submit');
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText('8');

  // تعديل إلى اعتذار → يُحفظ صفر ويختفي من المتوقع
  await page.locator('#responses-body tr', { hasText: 'بسمة حسن' }).getByRole('button', { name: /تعديل/ }).click();
  await page.locator('#edit-form input[value="declined"]').check();
  await expect(page.locator('#edit-count-field')).toBeHidden();
  await page.click('#edit-submit');
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText('6');
  await expect(page.locator('[data-stat="declined_responses"]')).toHaveText('3');
  expect(sqlJson(`select guest_count from rsvp_responses where guest_name='بسمة حسن'`)).toEqual([{ guest_count: 0 }]);

  // تجاوز الحد يُرفض من القاعدة
  await page.locator('#responses-body tr', { hasText: 'دينا صالح' }).getByRole('button', { name: /تعديل/ }).click();
  await page.fill('#edit-form input[name="guest_count"]', '9');
  await page.click('#edit-submit');
  await expect(page.locator('#edit-error')).toContainText('أكبر من الحد');
  await page.locator('#edit-dialog [data-close]').click();

  // حذف مع تأكيد (إلغاء أولًا ثم تأكيد)
  await page.locator('#responses-body tr', { hasText: 'هادي يوسف' }).getByRole('button', { name: /حذف/ }).click();
  await page.locator('#confirm-dialog [data-close]').click();
  await expect(page.locator('#responses-body tr', { hasText: 'هادي يوسف' })).toHaveCount(1);
  await page.locator('#responses-body tr', { hasText: 'هادي يوسف' }).getByRole('button', { name: /حذف/ }).click();
  await page.click('#confirm-ok');
  await expect(page.locator('#responses-body tr', { hasText: 'هادي يوسف' })).toHaveCount(0);
  await expect(page.locator('[data-stat="total_responses"]')).toHaveText('4');

  // إضافة رد يدوي
  await page.click('#add-response-btn');
  await page.fill('#edit-form input[name="guest_name"]', 'رد هاتفي');
  await page.locator('#edit-form input[value="attending"]').check();
  await page.fill('#edit-form input[name="guest_count"]', '2');
  await page.click('#edit-submit');
  await expect(page.locator('[data-stat="expected_guests"]')).toHaveText('8');
  expect(sqlJson(`select source from rsvp_responses where guest_name='رد هاتفي'`)).toEqual([{ source: 'admin' }]);

  // سجل التدقيق
  // السجل إلحاقي فقط (لا يُمسح بين الاختبارات) → نعدّ العمليات الجديدة فقط
  expect(sqlJson(`select action from admin_audit_logs where id > ${auditBaseline} order by id`).map((r) => r.action))
    .toEqual(['rsvp_update', 'rsvp_update', 'rsvp_delete', 'rsvp_insert']);
  await page.click('#tab-audit');
  await expect(page.locator('#audit-body tr').first()).toContainText('إضافة رد');
  await expect(page.locator('#audit-body')).toContainText('حذف رد');
  await expect(page.locator('#audit-body')).toContainText('تعديل رد');
  await expect(page.locator('#audit-body')).toContainText('أنت');
});

test('تصدير CSV: UTF-8 مع BOM وتعطيل الصيغ', async ({ page }) => {
  seedResponses();
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#responses-body tr')).toHaveCount(5);
  await page.click('#export-btn');
  await expect(page.locator('#confirm-text')).toContainText('أسماء المدعوين');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#confirm-ok')]);
  const buf = readFileSync(await download.path());
  expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const csv = buf.toString('utf8');
  expect(csv).toContain('اسم المدعو,حالة الحضور,عدد البالغين');
  expect(csv).toContain('أحمد علي');
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  expect(csv).not.toContain('edit_token');
  expect(csv.trim().split('\r\n')).toHaveLength(6);
});

test('الدعوات الشخصية: إنشاء رابط، عدّ من لم يرد، إلغاء وإصدار رابط جديد', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, ADMIN);
  await page.click('#tab-invitations');
  await page.fill('#inv-label', 'عائلة الحاج محمود');
  await page.fill('#inv-max', '6');
  await page.click('#inv-submit');
  await expect(page.locator('#link-dialog')).toBeVisible();
  const link = await page.locator('#link-value').inputValue();
  expect(link).toMatch(/\/#i=[A-Za-z0-9_-]{32}$/);
  const token = link.split('#i=')[1];
  expect(sqlJson(`select count(*)::int n from invitations where token_hash = extensions.digest('${token}', 'sha256')`)).toEqual([{ n: 1 }]);
  expect(sql(`select count(*) from invitations where encode(token_hash,'escape') like '%${token}%'`)).toBe('0');
  await page.locator('#link-dialog [data-close]').click();
  await expect(page.locator('#invitations-body tr')).toHaveCount(1);
  await expect(page.locator('#invitations-body')).toContainText('لم يرد بعد');

  await page.click('#tab-responses');
  await expect(page.locator('#stat-pending')).toBeVisible();
  await expect(page.locator('[data-stat="invitations_pending"]')).toHaveText('1');

  // الرد عبر الرابط ثم التحقق من التحديث
  const res = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, { data: { action: 'submit', invite_token: token, guest_name: 'محمود', attendance: 'attending', guest_count: 6 } });
  expect(res.status()).toBe(200);
  await page.click('#refresh-btn');
  await expect(page.locator('[data-stat="invitations_pending"]')).toHaveText('0');

  // إصدار رابط جديد يُبطل القديم
  await page.click('#tab-invitations');
  await page.locator('#invitations-body tr').getByRole('button', { name: 'رابط جديد' }).click();
  await page.click('#confirm-ok');
  await expect(page.locator('#link-dialog')).toBeVisible();
  const newToken = (await page.locator('#link-value').inputValue()).split('#i=')[1];
  expect(newToken).not.toBe(token);
  await page.locator('#link-dialog [data-close]').click();
  const old = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, { data: { action: 'submit', invite_token: token, guest_name: 'محمود', attendance: 'declined' } });
  expect(old.status()).toBe(403);

  // إلغاء الدعوة
  await page.locator('#invitations-body tr').getByRole('button', { name: 'إلغاء' }).click();
  await page.click('#confirm-ok');
  await expect(page.locator('#invitations-body')).toContainText('ملغاة');
  const revoked = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, { data: { action: 'submit', invite_token: newToken, guest_name: 'محمود', attendance: 'declined' } });
  expect(revoked.status()).toBe(403);
});

test('الإعدادات: تعديل الحد الأعلى ينعكس على صفحة الدعوة ويُفرض في الخادم', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, ADMIN);
  await page.click('#tab-settings');
  await expect(page.locator('#settings-form input[name="groom_name"]')).toHaveValue('يوسف');
  await expect(page.locator('#settings-form input[name="event_time"]')).toHaveValue('16:00');
  await page.fill('#settings-form input[name="max_guests_per_response"]', '3');
  await page.fill('#settings-form input[name="maps_url"]', 'http://insecure.example');
  await page.click('#settings-submit');
  await expect(page.locator('#settings-error')).toContainText('https://');
  await page.fill('#settings-form input[name="maps_url"]', '');
  await page.fill('#settings-form input[name="timezone"]', 'Not/AZone');
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('المنطقة الزمنية غير صحيحة');
  await page.fill('#settings-form input[name="timezone"]', 'Asia/Baghdad');
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(sqlJson('select max_guests_per_response from wedding_settings')).toEqual([{ max_guests_per_response: 3 }]);

  await page.goto('/');
  await expect(page.locator('[data-bind="max_guests"]')).toHaveText('3');
  const over = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, { data: { action: 'submit', request_id: crypto.randomUUID(), guest_name: 'اختبار حد', attendance: 'attending', guest_count: 4 } });
  expect(over.status()).toBe(422);
});

test('انتهاء الجلسة: العودة لصفحة الدخول برسالة واضحة', async ({ page }) => {
  seedResponses();
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#view-dashboard')).toBeVisible();
  await page.request.post(`${GATEWAY}/__test/expire-sessions`);
  await page.click('#refresh-btn');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#login-notice')).toContainText('انتهت الجلسة');
  await expect(page.locator('#responses-body')).toBeHidden();
});

test('تسجيل الخروج يعيد لصفحة الدخول ويبقى بعد إعادة التحميل', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, ADMIN);
  await expect(page.locator('#view-dashboard')).toBeVisible();
  await page.reload();
  await expect(page.locator('#view-dashboard')).toBeVisible(); // الجلسة محفوظة
  await page.click('#logout-btn');
  await expect(page.locator('#view-login')).toBeVisible();
  await page.reload();
  await expect(page.locator('#view-login')).toBeVisible();
});

test('كل النصوص والأسماء والموقع تُعدَّل من اللوحة وتظهر في صفحة الدعوة ورسالة واتساب', async ({ page }) => {
  await page.goto('/admin/');
  await login(page, ADMIN);
  await page.click('#tab-settings');
  const f = (name) => page.locator(`#settings-form [name="${name}"]`);
  await expect(f('rsvp_title')).toHaveValue('هل ستشاركوننا فرحتنا؟');
  await expect(f('children_note_title')).toHaveValue('ملاحظة مهمة لضيوفنا الكرام');

  await f('groom_name').fill('أحمد');
  await f('bride_name').fill('سارة');
  await f('venue_name').fill('قاعة الياسمين');
  await f('venue_address').fill('بغداد، شارع فلسطين');
  await f('maps_url').fill('https://maps.app.goo.gl/test123');
  await f('event_date').fill('2027-06-10');
  await f('event_time').fill('19:30');
  await f('verse_text').fill('');
  await f('intro_line').fill('بفرحة غامرة');
  await f('tagline').fill('يدعوانكم لحضور حفل زفافهما');
  await f('invitation_message').fill('سطر دعوة مخصص');
  await f('details_title').fill('تفاصيل الحفل');
  await f('countdown_title').fill('باقي على الفرح');
  await f('actions_title').fill('روابط مفيدة');
  await f('rsvp_title').fill('أكّدوا حضوركم');
  await f('rsvp_lead').fill('');
  await f('footer_text').fill('بانتظاركم');
  await f('children_note_title').fill('تنبيه لطيف');
  await f('children_note_body').fill('الدعوة للكبار فقط.\nشكرًا لتفهمكم.');
  await f('share_closing_text').fill('دمتم بخير');
  await f('whatsapp_number').fill('+964 770 123 4567');
  await f('site_url').fill('https://wedding.example/');

  // تحقق الواجهة قبل الحفظ
  await f('details_title').fill('');
  await page.click('#settings-submit');
  await expect(page.locator('#settings-error')).toContainText('عنوان قسم الموعد مطلوب');
  await f('details_title').fill('تفاصيل الحفل');
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(sqlJson('select groom_name, whatsapp_number, verse_text, rsvp_lead from wedding_settings')).toEqual([
    { groom_name: 'أحمد', whatsapp_number: '9647701234567', verse_text: null, rsvp_lead: null },
  ]);

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('أحمد');
  await expect(page.locator('h1')).toContainText('سارة');
  await expect(page.locator('.hero__verse')).toBeHidden();
  await expect(page.locator('.hero__intro')).toHaveText('بفرحة غامرة');
  await expect(page.locator('.hero__tagline')).toHaveText('يدعوانكم لحضور حفل زفافهما');
  await expect(page.locator('.intro-text')).toHaveText('سطر دعوة مخصص');
  await expect(page.locator('#details-title')).toHaveText('تفاصيل الحفل');
  await expect(page.locator('#countdown-title')).toHaveText('باقي على الفرح');
  await expect(page.locator('#actions-title')).toHaveText('روابط مفيدة');
  await expect(page.locator('#rsvp-title')).toHaveText('أكّدوا حضوركم');
  await expect(page.locator('.rsvp__lead')).toBeHidden();
  await expect(page.locator('.footer__thanks')).toHaveText('بانتظاركم');
  await expect(page.locator('.detail-card').nth(0)).toContainText('الخميس');
  await expect(page.locator('.detail-card').nth(0)).toContainText('10 يونيو 2027');
  await expect(page.locator('.detail-card').nth(1)).toContainText('7:30 مساءً');
  await expect(page.locator('.detail-card').nth(2)).toContainText('قاعة الياسمين');
  await expect(page.locator('#maps-link')).toHaveAttribute('href', 'https://maps.app.goo.gl/test123');
  await expect(page.locator('#children-note-title')).toHaveText('تنبيه لطيف');
  await expect(page.locator('#children-note-body p')).toHaveText(['الدعوة للكبار فقط.', 'شكرًا لتفهمكم.']);
  await expect(page).toHaveTitle('دعوة زفاف أحمد وسارة');

  const href = await page.locator('#whatsapp-link').getAttribute('href');
  expect(href.startsWith('https://wa.me/9647701234567?text=')).toBe(true);
  const text = decodeURIComponent(href.split('text=')[1]);
  for (const part of ['أحمد', 'سارة', 'قاعة الياسمين', 'https://maps.app.goo.gl/test123', 'https://wedding.example/', 'تنبيه لطيف', 'الدعوة للكبار فقط.', 'دمتم بخير']) {
    expect(text).toContain(part);
  }

  // إخفاء ملاحظة الأطفال من اللوحة
  await page.goto('/admin/');
  await page.click('#tab-settings');
  await expect(page.locator('#settings-form [name="groom_name"]')).toHaveValue('أحمد');
  await page.locator('#settings-form [name="show_children_note"]').uncheck();
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  await page.goto('/');
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(page.locator('#children-note')).toBeHidden();
  const href2 = await page.locator('#whatsapp-link').getAttribute('href');
  expect(decodeURIComponent(href2.split('text=')[1])).not.toContain('تنبيه لطيف');
});
