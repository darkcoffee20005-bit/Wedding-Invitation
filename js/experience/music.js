// موسيقى خلفية هادئة.
// - إن وُضع رابط موسيقى خاص من لوحة الإدارة: يُشغَّل ملف الصوت.
// - وإلا: لحن "صندوق موسيقى" أصلي يُولَّد داخل المتصفح بـ Web Audio (لا ملفات ولا حقوق ملكية).
// لا يبدأ التشغيل إلا بعد تفاعل المستخدم (فتح الظرف أو زر الموسيقى) كما تشترط المتصفحات.

const BPM = 66;
const BEAT = 60 / BPM;
// تسلسل هارموني دافئ (D - Bm - G - A) بنغمات مكسّرة، مع لحن علوي متفرق.
const CHORDS = [
  [62, 66, 69, 74], // D
  [59, 62, 66, 71], // Bm
  [55, 59, 62, 67], // G
  [57, 61, 64, 69], // A
];
const MELODY = [
  [78, 2], [76, 1], [74, 1], [73, 2], [74, 2],
  [71, 2], [73, 1], [74, 1], [76, 4],
  [74, 2], [71, 1], [69, 1], [71, 2], [67, 2],
  [69, 2], [73, 2], [74, 4],
];

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

function makeImpulse(ac, seconds = 2.8) {
  const len = Math.round(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
  }
  return buf;
}

class MusicBox {
  constructor() {
    this.ac = null;
    this.timer = 0;
    this.nextTime = 0;
    this.step = 0;
    this.melodyIdx = 0;
    this.melodyAt = 0;
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0;
    const reverb = this.ac.createConvolver();
    reverb.buffer = makeImpulse(this.ac);
    const wet = this.ac.createGain(); wet.gain.value = 0.38;
    const dry = this.ac.createGain(); dry.gain.value = 0.75;
    const lowpass = this.ac.createBiquadFilter();
    lowpass.type = 'lowpass'; lowpass.frequency.value = 5200;
    this.bus = this.ac.createGain();
    this.bus.connect(lowpass);
    lowpass.connect(dry).connect(this.master);
    lowpass.connect(reverb).connect(wet).connect(this.master);
    this.master.connect(this.ac.destination);
    return true;
  }

  note(midi, time, vel = 0.22, len = 2.4) {
    const ac = this.ac;
    const f = midiToHz(midi);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + len);
    g.connect(this.bus);
    // جرس صندوق الموسيقى: نغمة أساسية + توافقيات معدنية خافتة
    [[1, 1], [2.01, 0.28], [3.98, 0.1], [6.3, 0.04]].forEach(([mult, amp]) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const og = ac.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(time);
      o.stop(time + len + 0.05);
    });
  }

  schedule() {
    const ahead = this.ac.currentTime + 0.4;
    while (this.nextTime < ahead) {
      const bar = Math.floor(this.step / 8) % CHORDS.length;
      const chord = CHORDS[bar];
      const i = this.step % 8;
      // نمط مكسّر صعودًا ونزولًا
      const order = [0, 1, 2, 3, 2, 1, 2, 3];
      this.note(chord[order[i]] - (i === 0 ? 12 : 0), this.nextTime, i === 0 ? 0.2 : 0.11, i === 0 ? 3.2 : 2.2);
      // اللحن العلوي
      if (this.nextTime >= this.melodyAt) {
        const [m, beats] = MELODY[this.melodyIdx % MELODY.length];
        this.note(m, this.nextTime, 0.16, beats * BEAT * 1.6);
        this.melodyAt = this.nextTime + beats * BEAT;
        this.melodyIdx++;
      }
      this.nextTime += BEAT / 2;
      this.step++;
    }
  }

  async play() {
    if (!this.ac && !this.init()) return false;
    if (this.ac.state === 'suspended') await this.ac.resume();
    const now = this.ac.currentTime;
    if (this.nextTime < now) { this.nextTime = now + 0.08; this.melodyAt = this.nextTime; }
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.55, now + 2.5);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 120);
    this.schedule();
    return true;
  }

  pause() {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.8);
    setTimeout(() => { clearInterval(this.timer); this.ac && this.ac.suspend(); }, 900);
  }
}

class FilePlayer {
  constructor(url) {
    this.audio = new Audio();
    this.audio.src = url;
    this.audio.loop = true;
    this.audio.preload = 'none';
    this.audio.volume = 0;
    this.fade = 0;
  }

  async play() {
    try {
      await this.audio.play();
    } catch {
      return false;
    }
    clearInterval(this.fade);
    this.fade = setInterval(() => {
      this.audio.volume = Math.min(0.8, this.audio.volume + 0.04);
      if (this.audio.volume >= 0.8) clearInterval(this.fade);
    }, 100);
    return true;
  }

  pause() {
    clearInterval(this.fade);
    this.fade = setInterval(() => {
      this.audio.volume = Math.max(0, this.audio.volume - 0.08);
      if (this.audio.volume <= 0) { clearInterval(this.fade); this.audio.pause(); }
    }, 60);
  }
}

/** زر موسيقى عائم + مشغّل. */
export function createMusicControl() {
  let player = null;
  let url = null;
  let playing = false;
  let enabled = true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'music-toggle';
  btn.hidden = true;
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', 'تشغيل الموسيقى');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="music-toggle__icon"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
    <span class="music-toggle__bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
  document.body.appendChild(btn);

  function render() {
    btn.classList.toggle('is-playing', playing);
    btn.setAttribute('aria-pressed', String(playing));
    btn.setAttribute('aria-label', playing ? 'إيقاف الموسيقى' : 'تشغيل الموسيقى');
    btn.title = playing ? 'إيقاف الموسيقى' : 'تشغيل الموسيقى';
  }

  function ensurePlayer() {
    if (!player) player = url ? new FilePlayer(url) : new MusicBox();
    return player;
  }

  async function play() {
    if (!enabled) return;
    playing = await ensurePlayer().play();
    if (!playing && url) {
      // فشل الملف الخاص (رابط خاطئ أو محظور): نعود للحن المُولَّد
      player = new MusicBox();
      playing = await player.play();
    }
    render();
  }

  function pause() {
    if (player) player.pause();
    playing = false;
    render();
  }

  btn.addEventListener('click', () => {
    try { sessionStorage.setItem('wedding_music_muted', playing ? '1' : '0'); } catch { /* ignore */ }
    if (playing) pause(); else play();
  });

  return {
    configure({ enabled: on, url: musicUrl }) {
      enabled = on !== false;
      const nextUrl = musicUrl && /^https:\/\//i.test(musicUrl) ? musicUrl : null;
      if (nextUrl !== url && !playing) { url = nextUrl; player = null; }
      btn.hidden = !enabled;
      if (!enabled && playing) pause();
    },
    /** يُستدعى داخل نقرة فتح الظرف. */
    autoStart() {
      let muted = false;
      try { muted = sessionStorage.getItem('wedding_music_muted') === '1'; } catch { /* ignore */ }
      if (enabled && !muted) play();
    },
    get playing() { return playing; },
  };
}
