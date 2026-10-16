// اختبارات وحدات للوحدات النقية في الواجهة (بدون متصفح).
//   node --test tests/unit/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { zonedDateTimeToUtc, countdownParts, formatDateAr, formatWeekdayAr, formatTimeAr } from '../../js/time-utils.js';
import { buildIcs, foldIcsLine, escapeIcsText, googleCalendarUrl } from '../../js/calendar.js';
import { buildMapsUrl, buildInvitationText, buildWhatsAppUrl, publicSiteUrl } from '../../js/share.js';
import { sanitizeCsvCell, toCsv } from '../../js/csv.js';
import { CHILDREN_NOTE } from '../../js/content.js';
import { WEDDING_DEFAULTS } from '../../js/config.js';
import { validateRsvpInput, readInviteToken } from '../../js/rsvp.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const START = new Date('2027-05-27T13:00:00Z'); // 16:00 بغداد = 13:00 UTC

// ------------------------------------------------------------ الوقت
test('zonedDateTimeToUtc: 16:00 Asia/Baghdad → 13:00Z', () => {
  assert.equal(zonedDateTimeToUtc('2027-05-27', '16:00', 'Asia/Baghdad').toISOString(), '2027-05-27T13:00:00.000Z');
});

test('zonedDateTimeToUtc handles DST zones correctly', () => {
  assert.equal(zonedDateTimeToUtc('2027-05-27', '16:00', 'Europe/London').toISOString(), '2027-05-27T15:00:00.000Z');
  assert.equal(zonedDateTimeToUtc('2027-01-15', '16:00', 'America/New_York').toISOString(), '2027-01-15T21:00:00.000Z');
  assert.equal(zonedDateTimeToUtc('2027-05-27', '16:00', 'America/New_York').toISOString(), '2027-05-27T20:00:00.000Z');
});

test('target instant is identical regardless of the device time zone', () => {
  const script = `import('${new URL('../../js/time-utils.js', import.meta.url).href}').then(m => console.log(m.zonedDateTimeToUtc('2027-05-27','16:00','Asia/Baghdad').toISOString()))`;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Asia/Kolkata', 'America/St_Johns']) {
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString().trim();
    assert.equal(out, '2027-05-27T13:00:00.000Z', `device TZ ${tz}`);
  }
});

test('countdownParts: exact breakdown, never negative', () => {
  const t = START.getTime();
  assert.deepEqual(countdownParts(t, t - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000), { done: false, days: 2, hours: 3, minutes: 4, seconds: 5 });
  assert.deepEqual(countdownParts(t, t), { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(countdownParts(t, t + 999999), { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test('Arabic date formatting: Thursday 27 May 2027, 4:00 afternoon', () => {
  assert.equal(formatWeekdayAr(START, 'Asia/Baghdad'), 'الخميس');
  assert.equal(formatDateAr(START, 'Asia/Baghdad'), '27 مايو 2027');
  assert.equal(formatTimeAr('16:00'), '4:00 عصرًا');
  assert.equal(formatTimeAr('20:30'), '8:30 مساءً');
});

// ------------------------------------------------------------ التقويم
test('ICS file is valid RFC 5545 with correct UTC times', () => {
  const ics = buildIcs({
    title: 'حفل زفاف يوسف وشذى', description: 'سطر أول\nسطر, ثانٍ; ثالث', location: 'مزرعة الفرح، العابات على نهر دجلة',
    start: START, durationMinutes: 240, uid: 'wedding-test@invitation', now: new Date('2026-10-01T00:00:00Z'),
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nDTSTART:20270527T130000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20270527T170000Z\r\n/);
  assert.match(ics, /\r\nUID:wedding-test@invitation\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261001T000000Z\r\n/);
  assert.ok(ics.includes('سطر\\, ثانٍ\\; ثالث') || ics.replace(/\r\n /g, '').includes('سطر\\, ثانٍ\\; ثالث'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('ICS line folding keeps multi-byte characters intact', () => {
  const long = `SUMMARY:${'ش'.repeat(100)}`;
  const folded = foldIcsLine(long);
  assert.equal(folded.replace(/\r\n /g, ''), long);
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('Google Calendar link uses UTC range', () => {
  const url = new URL(googleCalendarUrl({ title: 't', description: 'd', location: 'l', start: START, durationMinutes: 240 }));
  assert.equal(url.searchParams.get('dates'), '20270527T130000Z/20270527T170000Z');
});

// ------------------------------------------------------------ الخرائط والمشاركة
test('maps URL: search link from venue + address when no exact link (no invented coordinates)', () => {
  const url = new URL(buildMapsUrl(WEDDING_DEFAULTS));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/search/');
  assert.equal(url.searchParams.get('query'), 'مزرعة الفرح، العابات على نهر دجلة');
  assert.ok(!/@-?\d+\.\d+,/.test(url.href), 'no coordinates');
  assert.equal(buildMapsUrl({ ...WEDDING_DEFAULTS, maps_url: 'https://maps.app.goo.gl/abc' }), 'https://maps.app.goo.gl/abc');
  assert.notEqual(buildMapsUrl({ ...WEDDING_DEFAULTS, maps_url: 'javascript:alert(1)' }), 'javascript:alert(1)');
});

test('invitation text includes names, date, time, venue, map, children note and closing', () => {
  const text = buildInvitationText(WEDDING_DEFAULTS, START, 'https://example.com/');
  for (const part of ['يوسف', 'شذى', 'الخميس', '27 مايو 2027', '4:00 عصرًا', 'مزرعة الفرح', 'العابات على نهر دجلة',
    'https://www.google.com/maps/search/', 'https://example.com/', CHILDREN_NOTE.title, ...CHILDREN_NOTE.paragraphs, 'دمتم بخير']) {
    assert.ok(text.includes(part), `missing: ${part}`);
  }
});

test('WhatsApp URL without a number lets the user pick the contact', () => {
  const url = buildWhatsAppUrl('مرحبا & أهلًا');
  assert.equal(url, `https://wa.me/?text=${encodeURIComponent('مرحبا & أهلًا')}`);
  assert.ok(buildWhatsAppUrl('x', '+964 770-000').startsWith('https://wa.me/964770000?'));
});

test('public site URL strips personal invitation tokens', () => {
  const loc = { href: 'https://site.example/path/?i=SECRET#i=SECRET' };
  assert.equal(publicSiteUrl('', loc), 'https://site.example/path/');
});

// ------------------------------------------------------------ CSV
test('CSV: UTF-8 BOM, Arabic preserved, quoting, formula injection neutralized', () => {
  const csv = toCsv([
    { name: 'سارة "الأولى"', msg: '=HYPERLINK("http://evil","x")' },
    { name: '+966', msg: '@SUM(A1)' },
    { name: '-2', msg: 'سطر\nجديد' },
  ], [{ key: 'name', label: 'الاسم' }, { key: 'msg', label: 'الرسالة' }]);
  assert.ok(csv.startsWith('﻿الاسم,الرسالة\r\n'));
  assert.ok(csv.includes('"سارة ""الأولى"""'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
  assert.ok(csv.includes("'+966,'@SUM(A1)"));
  assert.ok(csv.includes(`'-2,"سطر\nجديد"`));
  assert.equal(sanitizeCsvCell('\tcmd'), "'\tcmd");
  assert.equal(sanitizeCsvCell(null), '');
});

// ------------------------------------------------------------ التحقق من النموذج
test('RSVP client validation mirrors server rules', () => {
  const ok = validateRsvpInput({ name: '  أحمد   علي ', attendance: 'attending', countRaw: '2', message: ' مبروك ' }, 5);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.value, { guest_name: 'أحمد علي', attendance: 'attending', guest_count: 2, message: 'مبروك' });

  const declined = validateRsvpInput({ name: 'خالد', attendance: 'declined', countRaw: '7', message: '' }, 5);
  assert.deepEqual(declined.errors, {});
  assert.equal(declined.value.guest_count, 0);

  const bad = (input) => Object.keys(validateRsvpInput({ name: 'أحمد', attendance: 'attending', countRaw: '1', message: '', ...input }, 5).errors);
  assert.deepEqual(bad({ name: '   ' }), ['name']);
  assert.deepEqual(bad({ name: 'ا' }), ['name']);
  assert.deepEqual(bad({ name: 'ب'.repeat(81) }), ['name']);
  assert.deepEqual(bad({ attendance: null }), ['attendance']);
  for (const c of ['0', '-1', '1.5', 'abc', '', '6', '1e1']) assert.deepEqual(bad({ countRaw: c }), ['count'], `count ${c}`);
  assert.deepEqual(bad({ message: 'x'.repeat(501) }), ['message']);
});

test('invite token is read from #i= (preferred) or ?i=', () => {
  assert.equal(readInviteToken({ hash: '#i=abc', search: '' }), 'abc');
  assert.equal(readInviteToken({ hash: '', search: '?i=xyz' }), 'xyz');
  assert.equal(readInviteToken({ hash: '#rsvp', search: '' }), null);
});

// ------------------------------------------------------------ المحتوى
test('children note text is verbatim in content.js and index.html, before the RSVP form', () => {
  assert.equal(CHILDREN_NOTE.title, 'ملاحظة مهمة لضيوفنا الكرام');
  assert.equal(CHILDREN_NOTE.paragraphs[0], 'نعتذر منكم بكل محبة، ونرجو من ضيوفنا الكرام عدم اصطحاب الأطفال إلى الحفل، حيث إن الدعوة مخصصة للكبار فقط.');
  assert.equal(CHILDREN_NOTE.paragraphs[1], 'شاكرين لكم تفهّمكم وتعاونكم، ونتطلع إلى مشاركتكم فرحتنا بأجمل الأوقات.');
  const html = readFileSync(`${root}index.html`, 'utf8');
  const notePos = html.indexOf(CHILDREN_NOTE.title);
  assert.ok(notePos > 0);
  for (const p of CHILDREN_NOTE.paragraphs) assert.ok(html.includes(p));
  assert.ok(notePos < html.indexOf('id="rsvp-form"'), 'note appears before RSVP form');
  assert.ok(!/أطفال[^<]*<input/.test(html) && !/name="children/.test(html), 'no children count field');
});

test('no service_role key or secrets in browser files', () => {
  for (const f of ['js/config.js', 'js/supabase-client.js', 'js/admin-dashboard.js', 'js/rsvp-api.js', 'index.html', 'admin/index.html']) {
    const src = readFileSync(`${root}${f}`, 'utf8');
    assert.ok(!/service_role['"]?\s*[:=]\s*['"]ey/i.test(src), f);
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(src), f);
  }
});

test('all local imports and asset references resolve to existing files', () => {
  const check = (file, regex, base) => {
    const src = readFileSync(`${root}${file}`, 'utf8');
    for (const m of src.matchAll(regex)) {
      const ref = m[1];
      if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
      const target = new URL(ref, `file://${root}${base}`).pathname;
      const file = target.endsWith('/') ? `${target}index.html` : target;
      assert.doesNotThrow(() => readFileSync(file), `${base} → ${ref}`);
    }
  };
  check('index.html', /(?:src|href)="([^"]+)"/g, 'index.html');
  check('admin/index.html', /(?:src|href)="([^"]+)"/g, 'admin/index.html');
  for (const js of ['invitation.js', 'rsvp.js', 'rsvp-api.js', 'share.js', 'calendar.js', 'admin-dashboard.js', 'admin-auth.js', 'admin-charts.js', 'supabase-client.js']) {
    check(`js/${js}`, /from '(\.[^']+)'/g, `js/${js}`);
  }
});

test('invitation text uses editable settings (note, closing, intro) and can omit the note', () => {
  const custom = {
    ...WEDDING_DEFAULTS, groom_name: 'أحمد', bride_name: 'سارة', intro_line: 'بفرحة غامرة',
    children_note_title: 'تنبيه', children_note_body: 'سطر أول\n\nسطر ثانٍ', share_closing_text: 'دمتم سالمين',
  };
  const text = buildInvitationText(custom, START, '');
  for (const part of ['بفرحة غامرة', 'أحمد', 'سارة', 'تنبيه', 'سطر أول', 'سطر ثانٍ', 'دمتم سالمين']) assert.ok(text.includes(part), part);
  assert.ok(!text.includes(CHILDREN_NOTE.paragraphs[0]));
  const hidden = buildInvitationText({ ...custom, show_children_note: false }, START, '');
  assert.ok(!hidden.includes('تنبيه') && !hidden.includes('سطر أول'));
});

test('config defaults hold every editable page text, with the verbatim children note', () => {
  for (const k of ['verse_text', 'intro_line', 'tagline', 'invitation_message', 'details_title', 'countdown_title', 'countdown_done_text',
    'actions_title', 'rsvp_title', 'rsvp_lead', 'footer_text', 'children_note_title', 'children_note_body', 'share_closing_text']) {
    assert.ok(typeof WEDDING_DEFAULTS[k] === 'string' && WEDDING_DEFAULTS[k].length > 0, k);
  }
  assert.equal(WEDDING_DEFAULTS.children_note_body, CHILDREN_NOTE.paragraphs.join('\n'));
  const html = readFileSync(`${root}index.html`, 'utf8');
  for (const m of html.matchAll(/data-text="([a-z_]+)"/g)) assert.ok(m[1] in WEDDING_DEFAULTS, `index.html binds unknown key ${m[1]}`);
});
