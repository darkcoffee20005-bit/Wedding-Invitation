// مشهد افتتاحي: ظرف ثلاثي الأبعاد مختوم بختم شمع ذهبي يحمل الأحرف الأولى للعروسين.
// الضغط على الختم: ينكسر الختم ← ينفتح غطاء الظرف في الفضاء ← تخرج البطاقة ← تتسع لتصبح الدعوة.
// يدعم لوحة المفاتيح وقارئات الشاشة، ويحترم "تقليل الحركة"، ولا يظهر مرة ثانية في نفس الجلسة.
import { createAmbientField } from './particles.js';
import { onParallax } from './parallax.js';

const OPENED_KEY = 'wedding_intro_opened';

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function firstLetter(name) {
  const s = String(name || '').trim();
  // تجاوز "ال" التعريف إن وُجدت في بداية الاسم
  const clean = s.startsWith('ال') && s.length > 3 ? s.slice(2) : s;
  return [...clean][0] || '';
}

function shortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  return m ? `${Number(m[3])} . ${m[2]} . ${m[1]}` : '';
}

export function createEnvelope({ reduceMotion, effects, onOpenStart, onDone }) {
  const root = document.documentElement;
  const overlay = el('div', 'intro', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' });
  const canvas = el('canvas', 'intro__canvas', { 'aria-hidden': 'true' });
  const glow = el('div', 'intro__glow', { 'aria-hidden': 'true' });
  const stage = el('div', 'intro__stage');
  const kicker = el('p', 'intro__kicker', { id: 'intro-title' });
  kicker.textContent = 'دعوة زفاف';

  const env = el('div', 'envelope');
  const back = el('div', 'envelope__back', { 'aria-hidden': 'true' });
  const liner = el('div', 'envelope__liner', { 'aria-hidden': 'true' });

  const card = el('div', 'envelope__card', { 'aria-hidden': 'true' });
  const cardOrn = el('span', 'ornament envelope__card-ornament', { 'aria-hidden': 'true' });
  const cardNames = el('p', 'envelope__card-names');
  const groomEl = el('span'); const ampEl = el('span', 'envelope__amp'); const brideEl = el('span');
  ampEl.textContent = '&';
  cardNames.append(groomEl, ampEl, brideEl);
  const cardDate = el('p', 'envelope__card-date');
  card.append(cardOrn, cardNames, cardDate);

  const pocket = el('div', 'envelope__pocket');
  const pl = el('div', 'pocket pocket--start', { 'aria-hidden': 'true' });
  const pr = el('div', 'pocket pocket--end', { 'aria-hidden': 'true' });
  const pb = el('div', 'pocket pocket--bottom', { 'aria-hidden': 'true' });
  const to = el('p', 'envelope__to');
  const toLabel = el('span', 'envelope__to-label'); toLabel.textContent = 'إلى';
  const toName = el('strong', 'envelope__to-name'); toName.textContent = 'ضيوفنا الأعزاء';
  to.append(toLabel, toName);
  pocket.append(pl, pr, pb, to);

  const flap = el('div', 'envelope__flap', { 'aria-hidden': 'true' });
  flap.append(el('div', 'flap__face flap__face--front'), el('div', 'flap__face flap__face--back'));

  const seal = el('button', 'seal', { type: 'button', 'aria-label': 'افتحوا الدعوة' });
  const halfA = el('span', 'seal__half seal__half--a', { 'aria-hidden': 'true' });
  const halfB = el('span', 'seal__half seal__half--b', { 'aria-hidden': 'true' });
  const mono = () => {
    const m = el('span', 'seal__mono');
    return m;
  };
  const monoA = mono(); const monoB = mono();
  halfA.append(monoA); halfB.append(monoB);
  seal.append(el('span', 'seal__ring', { 'aria-hidden': 'true' }), halfA, halfB);

  env.append(back, liner, card, pocket, flap, seal);

  const hint = el('p', 'intro__hint');
  hint.textContent = 'اضغطوا على الختم لفتح الدعوة';
  const skip = el('button', 'intro__skip', { type: 'button' });
  skip.textContent = 'تخطّي';

  stage.append(kicker, env, hint);
  overlay.append(canvas, glow, stage, skip);
  document.body.appendChild(overlay);
  root.classList.add('intro-ready');

  let field = null;
  if (effects && !reduceMotion) {
    field = createAmbientField(canvas, { dust: 12, leaves: 1.4 });
    field.start();
  }
  const stopParallax = reduceMotion ? () => {} : onParallax((x, y) => {
    env.style.setProperty('--px', x.toFixed(3));
    env.style.setProperty('--py', y.toFixed(3));
  });

  // حصر التركيز داخل المشهد
  const focusables = () => [seal, skip].filter((b) => !b.disabled && b.offsetParent !== null);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); open({ fast: true }); }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }
  document.addEventListener('keydown', onKey);
  // تأخير بسيط حتى يكتمل رسم المشهد
  setTimeout(() => seal.focus({ preventScroll: true }), 60);

  let state = 'closed';
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function finish() {
    if (state === 'done') return;
    state = 'done';
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', onKey);
    stopParallax();
    field && field.stop();
    overlay.remove();
    root.classList.remove('intro-pending');
    root.classList.add('intro-done');
    try { sessionStorage.setItem(OPENED_KEY, '1'); } catch { /* ignore */ }
    onDone && onDone();
  }

  function open({ fast = false } = {}) {
    if (state === 'done') return;
    if (state !== 'closed') { // نقرة ثانية أثناء الحركة = تخطٍّ
      overlay.classList.add('is-leaving');
      later(finish, 350);
      return;
    }
    state = 'opening';
    seal.disabled = true;
    onOpenStart && onOpenStart();
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* ignore */ } }
    if (fast || reduceMotion) {
      overlay.classList.add('is-leaving', 'is-fast');
      later(finish, reduceMotion ? 450 : 350);
      return;
    }
    overlay.classList.add('is-opening');                       // انكسار الختم
    later(() => overlay.classList.add('is-flap-open'), 420);    // فتح الغطاء
    later(() => overlay.classList.add('is-card-out'), 1150);    // خروج البطاقة
    later(() => overlay.classList.add('is-leaving'), 2350);     // اتساع البطاقة وتلاشي المشهد
    later(finish, 3250);
  }

  seal.addEventListener('click', () => open());
  skip.addEventListener('click', () => open({ fast: true }));

  return {
    update(settings) {
      groomEl.textContent = settings.groom_name || '';
      brideEl.textContent = settings.bride_name || '';
      cardDate.textContent = shortDate(settings.event_date);
      const mono = `${firstLetter(settings.groom_name)}${firstLetter(settings.bride_name) ? ' ' + firstLetter(settings.bride_name) : ''}`;
      monoA.textContent = mono; monoB.textContent = mono;
    },
    setGuest(label) {
      if (label) toName.textContent = label;
    },
    dismiss() { finish(); },
    get isOpen() { return state !== 'closed'; },
  };
}
