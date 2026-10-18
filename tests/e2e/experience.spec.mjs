// اختبارات طبقة التجربة: الظرف ثلاثي الأبعاد، الدعوة الشخصية، الموسيقى، المؤثرات، تقويم الشهر، والاحتفال.
import { test, expect } from '@playwright/test';
import { resetData, sql, sqlJson, createInvitation, useLocalSupabase } from './helpers.mjs';

test.beforeEach(() => resetData());

async function openSeal(page) {
  // الختم يطفو باستمرار (حركة مقصودة)، لذا نضغطه دون انتظار ثباته
  await page.locator('.seal').click({ force: true });
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 6000 });
}

test('الظرف يظهر في أول زيارة، ويُفتح بالختم، ولا يتكرر في نفس الجلسة', async ({ page }) => {
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  const intro = page.locator('.intro');
  await expect(intro).toBeVisible();
  await expect(intro).toHaveAttribute('role', 'dialog');
  const seal = page.getByRole('button', { name: 'افتحوا الدعوة' });
  await expect(seal).toBeFocused();
  await expect(page.locator('.envelope__to-name')).toHaveText('ضيوفنا الأعزاء');
  await expect(page.locator('.envelope__card-names')).toContainText('يوسف');
  await expect(page.locator('.envelope__card-names')).toContainText('شذى');
  await expect(page.locator('.envelope__card-date')).toHaveText('27 . 05 . 2027');
  await expect(page.locator('.seal__mono').first()).toHaveText('ي ش');

  await openSeal(page);
  await expect(page.locator('html')).toHaveClass(/intro-done/);
  await expect(page.locator('html')).not.toHaveClass(/intro-pending/);
  expect(await page.evaluate(() => sessionStorage.getItem('wedding_intro_opened'))).toBe('1');
  await expect(page.locator('.hero__names')).toBeFocused();

  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/intro-pending/);
  await expect(page.locator('.intro')).toHaveCount(0);
});

test('Escape وزر «تخطّي» يفتحان الدعوة فورًا', async ({ page }) => {
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  await expect(page.locator('.intro')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 2000 });

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator('.intro')).toBeVisible();
  await page.locator('.intro__skip').click();
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 2000 });
});

test('التركيز محصور داخل مشهد الظرف (Tab يدور بين الختم والتخطي)', async ({ page }) => {
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  await expect(page.locator('.seal')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.intro__skip')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.seal')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 6000 });
});

test('رابط دعوة شخصية: اسم الضيف على الظرف وتحية خاصة ثم الانتقال لنموذج الرد', async ({ page }) => {
  const inv = createInvitation('عائلة الأستاذ كريم', 6);
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto(`/#i=${inv.token}`);
  await expect(page.locator('.envelope__to-name')).toHaveText('عائلة الأستاذ كريم');
  await openSeal(page);
  await expect(page.locator('#hero-guest')).toBeVisible();
  await expect(page.locator('#hero-guest')).toHaveText('أهلًا وسهلًا، عائلة الأستاذ كريم');
  await expect(page.locator('#rsvp-title')).toBeInViewport({ timeout: 5000 });
});

test('تعطيل مشهد الظرف من الإعدادات يُخفيه ويُتذكَّر في الزيارات التالية', async ({ page }) => {
  sql(`update public.wedding_settings set intro_enabled = false where id = 1;`);
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('wedding_intro_enabled'))).toBe('0');
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/intro-pending/);
});

test('المؤثرات الحية: تعمل افتراضيًا وتُعطَّل من الإعدادات', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/fx-on/);
  await expect(page.locator('.hero__canvas')).toBeVisible();
  // اللوحة ترسم فعلًا (بكسلات غير شفافة)
  await expect.poll(() => page.evaluate(() => {
    const c = document.querySelector('.hero__canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
    return n;
  })).toBeGreaterThan(50);

  sql(`update public.wedding_settings set effects_enabled = false where id = 1;`);
  await page.reload();
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(page.locator('html')).not.toHaveClass(/fx-on/);
});

test('تقليل الحركة: لا مؤثرات، والظرف يُفتح بتلاشٍ سريع', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  await expect(page.locator('.intro')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/fx-on/);
  await page.locator('.seal').click();
  await expect(page.locator('.intro')).toHaveCount(0, { timeout: 1500 });
  await expect(page.locator('.hero__canvas')).toBeHidden();
  await context.close();
});

test('زر الموسيقى: يعمل ويُكتم، ويختفي عند تعطيلها', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/');
  const btn = page.locator('.music-toggle');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'إيقاف الموسيقى');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => sessionStorage.getItem('wedding_music_muted'))).toBe('1');

  sql(`update public.wedding_settings set music_enabled = false where id = 1;`);
  await page.reload();
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(btn).toBeHidden();
});

test('الموسيقى تبدأ تلقائيًا مع فتح الظرف (نقرة المستخدم)', async ({ page }) => {
  await useLocalSupabase(page, { keepIntro: true });
  await page.goto('/');
  await openSeal(page);
  await expect(page.locator('.music-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('تقويم الشهر: مايو 2027 ويوم الحفل الخميس 27 مميز', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/');
  const card = page.locator('#month-card');
  await expect(card.locator('.month-card__title')).toHaveText('مايو 2027');
  await expect(card.locator('.month-card__day.is-event')).toHaveText('27');
  await expect(card).toHaveAttribute('aria-label', /الخميس 27/);
  await expect(card.locator('.month-card__heart')).toHaveCount(1);
  sql(`update public.wedding_settings set event_date = '2027-06-10' where id = 1;`);
  await page.reload();
  await expect(card.locator('.month-card__title')).toHaveText('يونيو 2027');
  await expect(card.locator('.month-card__day.is-event')).toHaveText('10');
});

test('تأكيد الحضور يطلق احتفال الأوراق الذهبية، وزر الرد العائم يظهر ويختفي بذكاء', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/');
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  const fab = page.locator('.fab-rsvp');
  await expect(fab).not.toHaveClass(/is-visible/);
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.2));
  await expect(fab).toHaveClass(/is-visible/);
  await fab.click();
  await expect(page.locator('#rsvp-title')).toBeInViewport();
  await expect(fab).not.toHaveClass(/is-visible/);

  await page.fill('#guest-name', 'ضيف سعيد');
  await page.locator('.choice:has(input[value="attending"])').click();
  await page.fill('#guest-count', '2');
  await page.click('#rsvp-submit');
  await expect(page.locator('#rsvp-success')).toBeVisible();
  await expect(page.locator('.fx-burst')).toHaveCount(1, { timeout: 2000 });
  await expect(page.locator('.fx-burst')).toHaveCount(0, { timeout: 8000 });
  expect(sqlJson('select guest_count from rsvp_responses')).toEqual([{ guest_count: 2 }]);
});

test('لوحة الإدارة تتحكم بالظرف والمؤثرات والموسيقى', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/admin/');
  await page.fill('#login-email', 'admin@test.local');
  await page.fill('#login-password', 'Admin-Test-Pass-1');
  await page.click('#login-submit');
  await page.click('#tab-settings');
  const f = (n) => page.locator(`#settings-form [name="${n}"]`);
  await expect(f('intro_enabled')).toBeChecked();
  await expect(f('effects_enabled')).toBeChecked();
  await expect(f('music_enabled')).toBeChecked();
  await f('intro_enabled').uncheck();
  await f('effects_enabled').uncheck();
  await f('music_url').fill('http://insecure.example/song.mp3');
  await page.click('#settings-submit');
  await expect(page.locator('#settings-error')).toContainText('رابط الموسيقى');
  await f('music_url').fill('https://cdn.example/song.mp3');
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(sqlJson('select intro_enabled, effects_enabled, music_enabled, music_url from wedding_settings')).toEqual([
    { intro_enabled: false, effects_enabled: false, music_enabled: true, music_url: 'https://cdn.example/song.mp3' },
  ]);
});

const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('الهوية اللونية: تُختار من اللوحة وتنعكس على الصفحة وتُتذكَّر في الزيارة التالية', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/admin/');
  await page.fill('#login-email', 'admin@test.local');
  await page.fill('#login-password', 'Admin-Test-Pass-1');
  await page.click('#login-submit');
  await page.click('#tab-settings');
  const options = page.locator('#theme-grid input[name="theme"]');
  await expect(options).toHaveCount(7);
  await expect(page.locator('#theme-grid input[value="emerald"]')).toBeChecked();
  await expect(page.getByRole('radio', { name: 'وردي ذهبي' })).toBeVisible();
  await expect(page.locator('#theme-grid a[href="../?theme=navy"]')).toHaveText('معاينة ↗');
  await page.getByRole('radio', { name: 'وردي ذهبي' }).check({ force: true });
  await page.click('#settings-submit');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(sqlJson('select theme from wedding_settings')).toEqual([{ theme: 'rose-gold' }]);

  await page.goto('/');
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose-gold');
  expect(await cssVar(page, '--emerald-800')).toBe('#4E1F2E');
  await expect(page.locator('#countdown')).not.toHaveCSS('background-image', /11, 61, 46|6, 46, 35/);
  expect(await page.evaluate(() => localStorage.getItem('wedding_theme'))).toBe('rose-gold');

  // الزيارة التالية: الهوية تُطبَّق فورًا من الذاكرة حتى قبل وصول الإعدادات من الخادم
  await page.route('**/functions/v1/rsvp', (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose-gold');
});

test('معاينة الهوية من الرابط ?theme= دون تغيير الإعدادات، وتجاهل القيم غير الصالحة', async ({ page }) => {
  await useLocalSupabase(page);
  await page.goto('/?theme=navy');
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'navy');
  expect(await cssVar(page, '--emerald-800')).toBe('#10264A');
  expect(sqlJson('select theme from wedding_settings')).toEqual([{ theme: 'emerald' }]);
  expect(await page.evaluate(() => localStorage.getItem('wedding_theme'))).not.toBe('navy');

  await page.goto('/?theme=<script>');
  await expect(page.locator('#rsvp-submit')).toBeEnabled();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});

test('كل الهويات: بلا أخطاء، بلا تمرير أفقي، والزخارف والختم والجسيمات بألوان الهوية', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await useLocalSupabase(page, { keepIntro: true });
  for (const t of ['emerald', 'navy', 'rose-gold', 'burgundy', 'noir', 'olive', 'royal']) {
    await page.goto(`/?theme=${t}`);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.locator('.intro')).toBeVisible();
    const accent = await cssVar(page, '--gold-500');
    const seal = await page.locator('.seal__half--a').evaluate((e) => getComputedStyle(e).backgroundImage);
    const sealVar = await cssVar(page, '--seal-3');
    const toRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(seal, `${t} seal`).toContain(toRgb(sealVar));
    await page.locator('.intro__skip').click();
    await expect(page.locator('.intro')).toHaveCount(0);
    const orn = await page.locator('.ornament--hero').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(orn, `${t} ornament`).toBe(toRgb(accent));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${t} overflow`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
