// اختبارات صفحة الدعوة ونموذج RSVP عبر المتصفح، متصلة بالـ Edge Function الحقيقية وقاعدة PostgreSQL.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resetData, sqlJson, createInvitation, useLocalSupabase, GATEWAY } from './helpers.mjs';

const NOTE_P1 = 'نعتذر منكم بكل محبة، ونرجو من ضيوفنا الكرام عدم اصطحاب الأطفال إلى الحفل، حيث إن الدعوة مخصصة للكبار فقط.';
const NOTE_P2 = 'شاكرين لكم تفهّمكم وتعاونكم، ونتطلع إلى مشاركتكم فرحتنا بأجمل الأوقات.';

test.beforeEach(async ({ page }) => {
  resetData();
  await useLocalSupabase(page);
});

async function waitReady(page) {
  // يكتمل تحميل السياق عندما يُفعَّل الزر أو تظهر رسالة.
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
}

function countSubmits(page) {
  const counter = { n: 0 };
  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/rsvp') && req.method() === 'POST' && (req.postData() || '').includes('"submit"')) counter.n++;
  });
  return counter;
}

async function fillRsvp(page, { name, attending = true, count, message }) {
  await page.fill('#guest-name', name);
  await page.locator(`.choice:has(input[value="${attending ? 'attending' : 'declined'}"])`).click();
  if (attending && count !== undefined) await page.fill('#guest-count', String(count));
  if (message !== undefined) await page.fill('#guest-message', message);
}

test.describe('صفحة الدعوة', () => {
  test('تعرض الأسماء والتاريخ والوقت والقاعة والملاحظة قبل النموذج', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('يوسف');
    await expect(page.locator('h1')).toContainText('شذى');
    await expect(page.locator('.detail-card').nth(0)).toContainText('الخميس');
    await expect(page.locator('.detail-card').nth(0)).toContainText('27 مايو 2027');
    await expect(page.locator('.detail-card').nth(1)).toContainText('4:00 عصرًا');
    await expect(page.locator('.detail-card').nth(1)).toContainText('16:00');
    await expect(page.locator('.detail-card').nth(2)).toContainText('مزرعة الفرح');
    await expect(page.locator('.detail-card').nth(2)).toContainText('العابات على نهر دجلة');

    const note = page.locator('#children-note');
    await expect(note).toBeVisible();
    await expect(note.locator('h2')).toHaveText('ملاحظة مهمة لضيوفنا الكرام');
    await expect(note.locator('p').nth(0)).toHaveText(NOTE_P1);
    await expect(note.locator('p').nth(1)).toHaveText(NOTE_P2);
    const order = await page.evaluate(() => {
      const n = document.getElementById('children-note');
      const f = document.getElementById('rsvp-form');
      return Boolean(n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    await expect(page.locator('input[name*="child" i], input[name*="kid" i]')).toHaveCount(0);
    await expect(page.locator('#guest-count-help')).toContainText('البالغين');
  });

  for (const timezoneId of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    test(`العد التنازلي صحيح من جهاز بمنطقة ${timezoneId}`, async ({ browser }) => {
      const context = await browser.newContext({ timezoneId, baseURL: 'http://127.0.0.1:5173' });
      const page = await context.newPage();
      await useLocalSupabase(page);
      // قبل الحفل بيوم و3 ساعات و4 دقائق و5 ثوانٍ بالضبط (الموعد = 13:00Z)
      await page.clock.setFixedTime(new Date('2027-05-26T09:55:55Z'));
      await page.goto('/');
      await expect(page.locator('[data-unit="days"]')).toHaveText('1');
      await expect(page.locator('[data-unit="hours"]')).toHaveText('03');
      await expect(page.locator('[data-unit="minutes"]')).toHaveText('04');
      await expect(page.locator('[data-unit="seconds"]')).toHaveText('05');
      await page.clock.setFixedTime(new Date('2027-05-26T09:55:57Z'));
      await expect(page.locator('[data-unit="seconds"]')).toHaveText('03');
      await context.close();
    });
  }

  test('بعد حلول الموعد: رسالة مناسبة ولا قيم سالبة', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-05-28T10:00:00Z'));
    await page.goto('/');
    await expect(page.locator('#countdown-done')).toBeVisible();
    for (const u of ['days', 'hours', 'minutes', 'seconds']) {
      await expect(page.locator(`[data-unit="${u}"]`)).not.toContainText('-');
    }
    await expect(page.locator('[data-unit="days"]')).toHaveText('0');
  });

  test('زر الخرائط: رابط بحث آمن في تبويب جديد', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('#maps-link');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    const href = await link.getAttribute('href');
    const url = new URL(href);
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('query')).toBe('مزرعة الفرح، العابات على نهر دجلة');
  });

  test('رابط الخرائط الدقيق من الإعدادات يُستخدم عند توفره', async ({ page }) => {
    const { sql } = await import('./helpers.mjs');
    sql(`update public.wedding_settings set maps_url = 'https://maps.app.goo.gl/example' where id = 1;`);
    await page.goto('/');
    await expect(page.locator('#maps-link')).toHaveAttribute('href', 'https://maps.app.goo.gl/example');
  });

  test('واتساب: رسالة جاهزة تتضمن ملاحظة الأطفال بدون رقم محدد', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('#whatsapp-link').getAttribute('href');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(href.split('text=')[1]);
    for (const part of ['يوسف', 'شذى', 'الخميس 27 مايو 2027', '4:00 عصرًا', 'مزرعة الفرح', 'العابات على نهر دجلة', 'google.com/maps', NOTE_P1, NOTE_P2]) {
      expect(text).toContain(part);
    }
  });

  test('نسخ نص الدعوة', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.click('#copy-btn');
    await expect(page.locator('#actions-status')).toContainText('تم نسخ');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(NOTE_P1);
    expect(clip).toContain('مزرعة الفرح');
  });

  test('ملف التقويم ICS صالح وبالتوقيت الصحيح', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#calendar-hint')).toBeVisible(); // المدة غير محددة → تنبيه
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#calendar-btn')]);
    expect(download.suggestedFilename()).toBe('wedding-invitation.ics');
    const ics = readFileSync(await download.path(), 'utf8');
    expect(ics).toContain('DTSTART:20270527T130000Z');
    expect(ics).toContain('DTEND:20270527T170000Z');
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:حفل زفاف يوسف وشذى');
    expect(ics.replace(/\r\n /g, '')).toContain('تقديري');
  });

  test('مدة الحفل المحددة من الإعدادات تُستخدم في التقويم', async ({ page }) => {
    const { sql } = await import('./helpers.mjs');
    sql(`update public.wedding_settings set duration_minutes = 300 where id = 1;`);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('#calendar-hint')).toBeHidden();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#calendar-btn')]);
    const ics = readFileSync(await download.path(), 'utf8');
    expect(ics).toContain('DTEND:20270527T180000Z');
  });

  test('إخفاء زر التقويم عند تعطيله من الإعدادات', async ({ page }) => {
    const { sql } = await import('./helpers.mjs');
    sql(`update public.wedding_settings set show_calendar_button = false where id = 1;`);
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('#calendar-btn')).toBeHidden();
  });

  test('أزرار «شاركونا الفرحة»: التمرير يجعل الخلفية زمردية داكنة والنص فاتحًا', async ({ page }) => {
    await page.goto('/');
    for (const sel of ['#maps-link', '#calendar-btn', '#whatsapp-link', '#copy-btn']) {
      const btn = page.locator(sel);
      await btn.scrollIntoViewIfNeeded();
      await btn.hover();
      await expect(btn).toHaveCSS('background-color', 'rgb(4, 36, 27)');
      await expect(btn).toHaveCSS('color', 'rgb(255, 253, 248)');
    }
    await page.mouse.move(0, 0);
    await expect(page.locator('#copy-btn')).toHaveCSS('background-color', 'rgb(255, 253, 248)');
  });

  test('لا تمرير أفقي على الهاتف والكمبيوتر', async ({ page }) => {
    for (const viewport of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `viewport ${viewport.width}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('نموذج تأكيد الحضور', () => {
  test('حقل العدد يظهر عند الحضور ويختفي عند الاعتذار', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('#guest-count-field')).toBeHidden();
    await page.locator('.choice:has(input[value="attending"])').click();
    await expect(page.locator('#guest-count-field')).toBeVisible();
    await page.locator('.choice:has(input[value="declined"])').click();
    await expect(page.locator('#guest-count-field')).toBeHidden();
  });

  test('رفض الاسم الفارغ وعدم اختيار الحالة دون إرسال طلب', async ({ page }) => {
    const submits = countSubmits(page);
    await page.goto('/');
    await waitReady(page);
    await page.fill('#guest-name', '    ');
    await page.click('#rsvp-submit');
    await expect(page.locator('#guest-name-error')).toBeVisible();
    await expect(page.locator('#attendance-error')).toBeVisible();
    await expect(page.locator('#guest-name')).toBeFocused();
    expect(submits.n).toBe(0);
    expect(sqlJson('select id from rsvp_responses')).toHaveLength(0);
  });

  for (const [value, label] of [['0', 'صفر'], ['-2', 'سالب'], ['1.5', 'كسر'], ['6', 'أكبر من الحد']]) {
    test(`رفض عدد الحضور: ${label}`, async ({ page }) => {
      const submits = countSubmits(page);
      await page.goto('/');
      await waitReady(page);
      await fillRsvp(page, { name: 'ضيف تجربة', count: value });
      await page.click('#rsvp-submit');
      await expect(page.locator('#guest-count-error')).toBeVisible();
      expect(submits.n).toBe(0);
    });
  }

  test('الخادم يرفض تجاوز الحد حتى لو تجاوز المستخدم تحقق الواجهة', async ({ page }) => {
    const res = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, {
      data: { action: 'submit', request_id: crypto.randomUUID(), guest_name: 'متلاعب', attendance: 'attending', guest_count: 40 },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toBe('guest_count_exceeds_limit');
    expect(sqlJson('select id from rsvp_responses')).toHaveLength(0);
  });

  test('إرسال حضور صحيح يُحفظ ثم تظهر رسالة النجاح', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await fillRsvp(page, { name: '  سارة   أحمد ', count: 3, message: 'ألف مبروك 🌿' });
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success')).toBeVisible();
    await expect(page.locator('#rsvp-summary')).toContainText('سارة أحمد');
    await expect(page.locator('#rsvp-summary')).toContainText('3');
    const rows = sqlJson('select guest_name, attendance, guest_count, message, source from rsvp_responses');
    expect(rows).toEqual([{ guest_name: 'سارة أحمد', attendance: 'attending', guest_count: 3, message: 'ألف مبروك 🌿', source: 'open' }]);
  });

  test('إرسال اعتذار صحيح يُحفظ بعدد صفر', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.locator('.choice:has(input[value="attending"])').click();
    await page.fill('#guest-count', '4');
    await page.fill('#guest-name', 'خالد');
    await page.locator('.choice:has(input[value="declined"])').click();
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success')).toBeVisible();
    expect(sqlJson('select attendance, guest_count from rsvp_responses')).toEqual([{ attendance: 'declined', guest_count: 0 }]);
  });

  test('منع الضغط المزدوج: طلب واحد وصف واحد', async ({ page }) => {
    const submits = countSubmits(page);
    await page.route('**/functions/v1/rsvp', async (route) => {
      if ((route.request().postData() || '').includes('"submit"')) await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto('/');
    await waitReady(page);
    await fillRsvp(page, { name: 'ضغط مزدوج', count: 2 });
    await page.locator('#rsvp-submit').dblclick();
    await page.locator('#rsvp-form').evaluate((f) => f.requestSubmit());
    await expect(page.locator('#rsvp-submit')).toBeDisabled();
    await expect(page.locator('#rsvp-submit')).toContainText('جارٍ الإرسال');
    await expect(page.locator('#rsvp-success')).toBeVisible();
    expect(submits.n).toBe(1);
    expect(sqlJson('select id from rsvp_responses')).toHaveLength(1);
  });

  test('انقطاع الشبكة: رسالة خطأ، لا نجاح وهمي، البيانات محفوظة، وإعادة المحاولة لا تكرر', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    // الخادم يحفظ الرد لكن الاستجابة تضيع (أسوأ حالة) → إعادة المحاولة يجب ألا تنشئ ردًا ثانيًا
    await page.route('**/functions/v1/rsvp', async (route) => {
      await route.fetch();
      await route.abort('connectionreset');
    });
    await fillRsvp(page, { name: 'شبكة ضعيفة', count: 2, message: 'تهنئة' });
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-alert')).toContainText('تعذّر الاتصال');
    await expect(page.locator('#rsvp-success')).toBeHidden();
    await expect(page.locator('#guest-name')).toHaveValue('شبكة ضعيفة');
    await expect(page.locator('#guest-message')).toHaveValue('تهنئة');
    await expect(page.locator('#rsvp-submit')).toBeEnabled();

    await page.unroute('**/functions/v1/rsvp');
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success')).toBeVisible();
    expect(sqlJson('select guest_name from rsvp_responses')).toHaveLength(1);
  });

  test('خطأ الخادم 500: لا تظهر رسالة نجاح', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.route('**/functions/v1/rsvp', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"server_error"}' }));
    await fillRsvp(page, { name: 'خطأ خادم', count: 1 });
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-alert')).toContainText('خطأ غير متوقع');
    await expect(page.locator('#rsvp-success')).toBeHidden();
    expect(sqlJson('select id from rsvp_responses')).toHaveLength(0);
  });

  test('تعذّر تحميل السياق: تنبيه مع زر إعادة المحاولة', async ({ page }) => {
    await page.route('**/functions/v1/rsvp', (route) => route.abort('connectionrefused'));
    await page.goto('/');
    await expect(page.locator('#rsvp-banner')).toContainText('تعذّر الاتصال');
    await page.unroute('**/functions/v1/rsvp');
    await page.locator('#rsvp-banner button').click();
    await expect(page.locator('#rsvp-banner')).toBeHidden();
  });

  test('تعديل الرد العام من نفس الجهاز بدل تكراره', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await fillRsvp(page, { name: 'منى', count: 2 });
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success')).toBeVisible();

    await page.reload();
    await expect(page.locator('#rsvp-banner')).toContainText('سبق أن سجّلتم ردكم');
    await expect(page.locator('#guest-name')).toHaveValue('منى');
    await expect(page.locator('#guest-count')).toHaveValue('2');
    await page.fill('#guest-count', '4');
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success-title')).toHaveText('تم تحديث ردكم بنجاح');
    expect(sqlJson('select guest_count from rsvp_responses')).toEqual([{ guest_count: 4 }]);
  });

  test('رابط دعوة شخصية: رد واحد قابل للتعديل وحد خاص', async ({ page }) => {
    const inv = createInvitation('عائلة الأستاذ كريم', 8);
    await page.goto(`/#i=${inv.token}`);
    await waitReady(page);
    await expect(page.locator('#rsvp-banner')).toContainText('عائلة الأستاذ كريم');
    await expect(page.locator('[data-bind="max_guests"]')).toHaveText('8');
    await page.fill('#guest-name', 'كريم جاسم');
    await page.locator('.choice:has(input[value="attending"])').click();
    await page.fill('#guest-count', '7');
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success')).toBeVisible();

    await page.goto('/');
    await page.goto(`/#i=${inv.token}`);
    await page.reload();
    await expect(page.locator('#rsvp-banner')).toContainText('سبق أن سجّلتم ردكم');
    await page.locator('.choice:has(input[value="declined"])').click();
    await page.click('#rsvp-submit');
    await expect(page.locator('#rsvp-success-title')).toHaveText('تم تحديث ردكم بنجاح');
    const rows = sqlJson(`select attendance, guest_count, source from rsvp_responses where invitation_id = '${inv.id}'`);
    expect(rows).toEqual([{ attendance: 'declined', guest_count: 0, source: 'invitation' }]);
    expect(sqlJson('select id from rsvp_responses')).toHaveLength(1);
  });

  test('رابط دعوة غير صالح: تحذير مع إمكانية الرد العام', async ({ page }) => {
    await page.goto('/#i=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await waitReady(page);
    await expect(page.locator('#rsvp-banner')).toContainText('رابط الدعوة غير صالح');
  });

  test('عند إلزام الدعوات الشخصية: النموذج العام مغلق', async ({ page }) => {
    const { sql } = await import('./helpers.mjs');
    sql(`update public.wedding_settings set allow_open_rsvp = false where id = 1;`);
    await page.goto('/');
    await expect(page.locator('#rsvp-banner')).toContainText('رابط الدعوة الشخصي');
    await expect(page.locator('#rsvp-form')).toBeHidden();
  });

  test('عند إغلاق الردود: رسالة واضحة', async ({ page }) => {
    const { sql } = await import('./helpers.mjs');
    sql(`update public.wedding_settings set rsvp_open = false where id = 1;`);
    await page.goto('/');
    await expect(page.locator('#rsvp-banner')).toContainText('انتهت فترة تأكيد الحضور');
    await expect(page.locator('#rsvp-form')).toBeHidden();
  });

  test('بدون إعداد Supabase: لا إرسال وهمي ورسالة واضحة', async ({ browser }) => {
    const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5173' });
    await page.goto('/');
    await expect(page.locator('#rsvp-banner')).toContainText('لم يُربط بالخادم');
    await expect(page.locator('#rsvp-submit')).toBeDisabled();
    await page.close();
  });

  test('الصفحة العامة لا تكشف ردود الآخرين', async ({ page }) => {
    createInvitation('شخص آخر');
    await page.goto('/');
    await waitReady(page);
    const ctx = await page.request.post(`${GATEWAY}/functions/v1/rsvp`, { data: { action: 'context' } });
    const body = await ctx.json();
    expect(body.response).toBeNull();
    expect(JSON.stringify(body)).not.toContain('شخص آخر');
  });
});
