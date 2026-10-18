// نقطة دخول صفحة الدعوة: ربط الإعدادات بالعناصر، العد التنازلي، الأزرار، ونموذج RSVP.
import { getUiConfig, getWeddingDefaults } from './config.js';
import {
  zonedDateTimeToUtc, countdownParts, formatDateAr, formatWeekdayAr, formatTimeAr, timeZoneLabelAr,
} from './time-utils.js';
import { buildIcs, googleCalendarUrl, downloadTextFile } from './calendar.js';
import { buildMapsUrl, buildInvitationText, buildWhatsAppUrl, publicSiteUrl, copyText, splitParagraphs } from './share.js';
import { createRsvpController } from './rsvp.js';
import { createExperience } from './experience/index.js';

document.documentElement.classList.add('js');

// طبقة التجربة (الظرف ثلاثي الأبعاد، المؤثرات، الموسيقى): أي خطأ فيها لا يوقف الدعوة.
let experience = null;
try {
  experience = createExperience();
} catch (err) {
  document.documentElement.classList.remove('intro-pending');
  console.error('experience layer failed', err);
}

const ui = getUiConfig();
const state = {
  settings: getWeddingDefaults(),
  start: null,
};

// ------------------------------------------------------------ ربط الإعدادات
function bindText(name, value) {
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => { el.textContent = value; });
}

// رابط الموقع ورقم واتساب: من لوحة الإدارة أولًا، ثم js/config.js.
function siteUrl() {
  return publicSiteUrl(state.settings.site_url || ui.siteUrl);
}
function whatsappNumber() {
  return state.settings.whatsapp_number || ui.whatsappNumber;
}

function invitationText() {
  return buildInvitationText(state.settings, state.start, siteUrl());
}

/** نصوص الصفحة القابلة للتعديل: العنصر يُخفى إن كان النص فارغًا، والعناوين تعود للافتراضي. */
function bindContent(s) {
  const defaults = getWeddingDefaults();
  document.querySelectorAll('[data-text]').forEach((el) => {
    const key = el.dataset.text;
    const value = typeof s[key] === 'string' ? s[key].trim() : '';
    if (key === 'countdown_done_text') {
      el.textContent = value || defaults[key];
      return; // ظهوره يتحكم به العد التنازلي
    }
    el.textContent = value || (el.tagName === 'H2' ? defaults[key] : '');
    if (el.tagName !== 'H2') el.hidden = !value;
  });

  document.querySelector('.section--intro').hidden = !String(s.invitation_message || '').trim();
  const noteSection = document.getElementById('children-note');
  noteSection.hidden = s.show_children_note === false;
  const paragraphs = splitParagraphs(s.children_note_body);
  if (paragraphs.length) {
    document.getElementById('children-note-body').replaceChildren(...paragraphs.map((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    }));
  }
}

function calendarEvent() {
  const s = state.settings;
  const durationKnown = Number.isInteger(s.duration_minutes) && s.duration_minutes > 0;
  const description = [
    `حفل زفاف ${s.groom_name} و${s.bride_name}.`,
    `${s.venue_name} — ${s.venue_address}`,
    `الخريطة: ${buildMapsUrl(s)}`,
    'الدعوة مخصصة للكبار فقط.',
    durationKnown ? '' : 'ملاحظة: مدة الحفل لم تُحدَّد بعد، ووقت الانتهاء تقديري.',
  ].filter(Boolean).join('\n');
  return {
    title: `حفل زفاف ${s.groom_name} و${s.bride_name}`,
    description,
    location: `${s.venue_name}، ${s.venue_address}`,
    start: state.start,
    durationMinutes: durationKnown ? s.duration_minutes : ui.calendarFallbackDurationMinutes,
    durationKnown,
    uid: `wedding-${s.event_date}-${s.event_time.replace(':', '')}@invitation`,
    url: siteUrl() || undefined,
  };
}

function applySettings(settings) {
  state.settings = { ...state.settings, ...settings };
  const s = state.settings;
  state.start = zonedDateTimeToUtc(s.event_date, s.event_time, s.timezone);

  bindText('groom_name', s.groom_name);
  bindText('bride_name', s.bride_name);
  bindText('weekday', formatWeekdayAr(state.start, s.timezone));
  bindText('date_long', formatDateAr(state.start, s.timezone));
  bindText('time_ar', formatTimeAr(s.event_time));
  bindText('event_time', s.event_time);
  bindText('tz_label', timeZoneLabelAr(s.timezone));
  bindText('venue_name', s.venue_name);
  bindText('venue_address', s.venue_address);
  document.title = `دعوة زفاف ${s.groom_name} و${s.bride_name}`;
  bindContent(s);

  document.getElementById('maps-link').href = buildMapsUrl(s);
  document.getElementById('whatsapp-link').href = buildWhatsAppUrl(invitationText(), whatsappNumber());

  const calendarBox = document.getElementById('calendar-actions');
  calendarBox.hidden = !s.show_calendar_button;
  const ev = calendarEvent();
  document.getElementById('google-calendar-link').href = googleCalendarUrl(ev);
  document.getElementById('calendar-hint').hidden = !s.show_calendar_button || ev.durationKnown;

  try {
    experience && experience.applySettings(s, {
      weekdayLabel: formatWeekdayAr(state.start, s.timezone),
      timeLabel: `${formatTimeAr(s.event_time)}`,
    });
  } catch (err) { console.error('experience settings failed', err); }

  tick();
}

// ------------------------------------------------------------ العد التنازلي
const countdownEls = {
  days: document.querySelector('[data-unit="days"]'),
  hours: document.querySelector('[data-unit="hours"]'),
  minutes: document.querySelector('[data-unit="minutes"]'),
  seconds: document.querySelector('[data-unit="seconds"]'),
};
let lastSrMinute = null;
let timer = null;

/** تحديث رقم مع حركة "قلب البطاقة" ثلاثية الأبعاد عند تغيّره. */
function setUnit(el, value) {
  if (el.textContent === value) return;
  el.textContent = value;
  const unit = el.parentElement;
  unit.classList.remove('is-flipping');
  void unit.offsetWidth; // إعادة تشغيل الحركة
  unit.classList.add('is-flipping');
}

function tick() {
  if (!state.start) return;
  // يُحسب الفرق من الوقت الحالي في كل تحديث (لا عدّاد يدوي).
  const p = countdownParts(state.start.getTime(), Date.now());
  setUnit(countdownEls.days, String(p.days));
  setUnit(countdownEls.hours, String(p.hours).padStart(2, '0'));
  setUnit(countdownEls.minutes, String(p.minutes).padStart(2, '0'));
  setUnit(countdownEls.seconds, String(p.seconds).padStart(2, '0'));
  document.getElementById('countdown-done').hidden = !p.done;
  document.getElementById('countdown-grid').classList.toggle('is-done', p.done);

  const srKey = p.done ? 'done' : `${p.days}:${p.hours}:${p.minutes}`;
  if (srKey !== lastSrMinute) {
    lastSrMinute = srKey;
    document.getElementById('countdown-sr').textContent = p.done
      ? 'حلّ موعد الحفل.'
      : `متبقٍ على الحفل ${p.days} يوم و${p.hours} ساعة و${p.minutes} دقيقة.`;
  }
}

function scheduleTick() {
  clearTimeout(timer);
  tick();
  // مزامنة مع بداية كل ثانية.
  timer = setTimeout(scheduleTick, 1000 - (Date.now() % 1000) + 5);
}

// ------------------------------------------------------------ الأزرار
const statusEl = document.getElementById('actions-status');
let statusTimer = null;
function flashStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--danger)' : '';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 5000);
}

document.getElementById('copy-btn').addEventListener('click', async () => {
  const ok = await copyText(invitationText());
  flashStatus(ok ? 'تم نسخ نص الدعوة ✓' : 'تعذّر النسخ تلقائيًا. يرجى المحاولة مرة أخرى.', !ok);
});

document.getElementById('calendar-btn').addEventListener('click', () => {
  const ev = calendarEvent();
  downloadTextFile('wedding-invitation.ics', buildIcs(ev), 'text/calendar;charset=utf-8');
  flashStatus('تم تجهيز ملف التقويم — افتحه لإضافة الموعد.');
});

// ------------------------------------------------------------ حركات الظهور
function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
}

// ------------------------------------------------------------ التشغيل
applySettings({});
scheduleTick();
setupReveal();
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleTick(); });

const rsvp = createRsvpController();
rsvp.loadContext().then((ctx) => {
  if (ctx && ctx.settings) applySettings(ctx.settings);
  // دعوة شخصية: اسم الضيف على الظرف وتحية خاصة في الواجهة
  if (ctx && ctx.invitation && ctx.invitation.status === 'valid') {
    try { experience && experience.setGuest(ctx.invitation.guest_label); } catch { /* ignore */ }
  }
});

// عند فتح رابط دعوة شخصية: الانتقال لنموذج الرد (بعد فتح الظرف إن كان ظاهرًا).
if (rsvp.state.inviteToken && !location.hash.startsWith('#rsvp')) {
  const goToRsvp = () => requestAnimationFrame(() => document.getElementById('rsvp').scrollIntoView({ block: 'start' }));
  if (document.documentElement.classList.contains('intro-pending')) {
    document.addEventListener('invitation:opened', () => setTimeout(goToRsvp, 900), { once: true });
  } else {
    goToRsvp();
  }
}

window.__weddingInvitation = { state }; // للفحص اليدوي في أدوات المطور
