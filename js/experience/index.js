// طبقة التجربة: تجمع الظرف ثلاثي الأبعاد، المؤثرات الحية، الإمالة، الموسيقى، وتقويم الشهر.
// منفصلة عن منطق الدعوة والردود؛ إن فشلت لأي سبب تبقى الدعوة تعمل كاملة.
import { startParallax, onParallax, requestGyroPermission, attachCardTilt } from './parallax.js';
import { createAmbientField, celebrate, refreshPalette } from './particles.js';
import { createEnvelope } from './envelope.js';
import { createMusicControl } from './music.js';
import { renderMonthCard } from './month-card.js';

export function createExperience() {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let settings = {};
  let effectsOn = true;
  let heroField = null;
  let stopHeroTilt = null;
  let entered = false;

  refreshPalette(); // ألوان الجسيمات من الهوية التي طبّقها boot.js
  startParallax();
  const music = createMusicControl();

  // ---------------------------------------------------------------- دخول الواجهة
  function enterHero() {
    if (entered) return;
    entered = true;
    root.classList.add('hero-enter');
  }

  // ---------------------------------------------------------------- الظرف
  let envelope = null;
  if (root.classList.contains('intro-pending')) {
    envelope = createEnvelope({
      reduceMotion,
      effects: true,
      onOpenStart: () => {
        requestGyroPermission(); // iOS: يجب طلبه داخل النقرة
        music.autoStart();
      },
      onDone: () => {
        enterHero();
        const h1 = document.querySelector('.hero__names');
        if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
        if (effectsOn) {
          const r = h1 ? h1.getBoundingClientRect() : null;
          celebrate(window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2, 110);
        }
        document.dispatchEvent(new CustomEvent('invitation:opened'));
      },
    });
  } else {
    requestAnimationFrame(enterHero);
  }

  // ---------------------------------------------------------------- مؤثرات الواجهة
  function startEffects() {
    if (reduceMotion) return;
    const canvas = document.querySelector('.hero__canvas');
    if (canvas && !heroField) {
      heroField = createAmbientField(canvas, { dust: 10, leaves: 2.4 });
      heroField.start();
    }
    const frame = document.querySelector('.hero__frame');
    if (frame && !stopHeroTilt) {
      stopHeroTilt = onParallax((x, y) => {
        frame.style.setProperty('--tilt-x', `${(-y * 6).toFixed(2)}deg`);
        frame.style.setProperty('--tilt-y', `${(x * 8).toFixed(2)}deg`);
      });
    }
  }
  function stopEffects() {
    heroField && heroField.stop(); heroField = null;
    stopHeroTilt && stopHeroTilt(); stopHeroTilt = null;
  }

  document.querySelectorAll('[data-tilt]').forEach((card) => { if (!reduceMotion) attachCardTilt(card, 6); });

  // ---------------------------------------------------------------- شريط التقدم وزر الرد العائم
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);

  const fab = document.createElement('a');
  fab.className = 'fab-rsvp';
  fab.href = '#rsvp';
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.6a4.3 4.3 0 017.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>تأكيد الحضور</span>';
  document.body.appendChild(fab);

  let rsvpVisible = false;
  let rsvpDone = false;
  const rsvpSection = document.getElementById('rsvp');
  if (rsvpSection && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { rsvpVisible = e.isIntersecting; onScroll(); }, { threshold: 0.05 }).observe(rsvpSection);
  }
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? window.scrollY / max : 0;
      progress.style.transform = `scaleX(${ratio.toFixed(4)})`;
      const pastHero = window.scrollY > window.innerHeight * 0.75;
      fab.classList.toggle('is-visible', pastHero && !rsvpVisible && !rsvpDone);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------------------------------------------------------------- احتفال تأكيد الحضور
  document.addEventListener('rsvp:success', (e) => {
    rsvpDone = true;
    onScroll();
    if (!effectsOn || e.detail?.attendance !== 'attending') return;
    const icon = document.querySelector('.rsvp-success__icon');
    const r = icon ? icon.getBoundingClientRect() : null;
    setTimeout(() => celebrate(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2, 120), 120);
  });

  return {
    applySettings(s, { weekdayLabel, timeLabel } = {}) {
      settings = { ...settings, ...s };
      envelope && envelope.update(settings);
      try { localStorage.setItem('wedding_intro_enabled', settings.intro_enabled === false ? '0' : '1'); } catch { /* ignore */ }
      if (settings.intro_enabled === false && envelope && !envelope.isOpen) envelope.dismiss();

      refreshPalette();
      heroField && heroField.recolor();
      effectsOn = settings.effects_enabled !== false;
      root.classList.toggle('fx-on', effectsOn && !reduceMotion);
      if (effectsOn) startEffects(); else stopEffects();

      music.configure({ enabled: settings.music_enabled !== false, url: settings.music_url });
      renderMonthCard(document.getElementById('month-card'), settings, { weekdayLabel, timeLabel });
    },
    setGuest(label) {
      if (!label) return;
      envelope && envelope.setGuest(label);
      const g = document.getElementById('hero-guest');
      if (g) { g.textContent = `أهلًا وسهلًا، ${label}`; g.hidden = false; }
    },
  };
}
