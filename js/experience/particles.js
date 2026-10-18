// محرك جسيمات ثلاثي الأبعاد خفيف (Canvas 2D مع إسقاط منظوري، بلا مكتبات):
// - غبار ذهبي متلألئ وأوراق تتساقط وتدور حول محاورها الثلاثة، بأعماق مختلفة.
// - الجسيمات القريبة تتحرك أكثر مع ميلان الهاتف/المؤشر (Parallax) فيظهر عمق حقيقي.
// - انفجار احتفالي من أوراق ذهبية عند فتح الظرف وتأكيد الحضور.
import { parallaxValue } from './parallax.js';

const PALETTE = {
  gold: ['#E8D9B5', '#D9BE84', '#C2A063', '#F5ECD7'],
  ivory: ['#FFFDF8', '#FBF7EE', '#F5ECD7'],
  emerald: ['#2E8A68', '#3FA07B'],
};

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function leafPath(ctx, s) {
  // ورقة بيضاوية مدببة (مثل أوراق الزخرفة) + عِرق أوسط
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.62, -s * 0.55, s * 0.62, s * 0.55, 0, s);
  ctx.bezierCurveTo(-s * 0.62, s * 0.55, -s * 0.62, -s * 0.55, 0, -s);
  ctx.closePath();
}

function petalPath(ctx, s) {
  // بتلة مستديرة الطرف
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(s * 0.9, s * 0.3, s * 0.7, -s * 0.9, 0, -s * 0.75);
  ctx.bezierCurveTo(-s * 0.7, -s * 0.9, -s * 0.9, s * 0.3, 0, s);
  ctx.closePath();
}

// توهجات مرسومة مسبقًا مرة واحدة لكل لون (أسرع بكثير من إنشاء تدرج لكل جسيم في كل إطار)
const spriteCache = new Map();
function glowSprite(color) {
  if (spriteCache.has(color)) return spriteCache.get(color);
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(194,160,99,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(color, c);
  return c;
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  };
  return { ctx, resize };
}

/**
 * حقل جسيمات دائم داخل عنصر (مثل الواجهة الرئيسية أو مشهد الظرف).
 * @param {HTMLCanvasElement} canvas
 * @param {{dust?: number, leaves?: number}} opts كثافة لكل 100 ألف بكسل مربع
 */
export function createAmbientField(canvas, opts = {}) {
  const { ctx, resize } = setupCanvas(canvas);
  let size = resize();
  let particles = [];
  let raf = 0;
  let running = false;
  let last = 0;
  let visible = true;

  const FOCAL = 1.0;

  function makeDust(initial) {
    return {
      kind: 'dust',
      x: rand(-1.2, 1.2), y: initial ? rand(-1.1, 1.1) : rand(-1.2, -1.05), z: rand(0.45, 2.4),
      vy: rand(0.006, 0.03), vx: rand(-0.01, 0.01),
      r: rand(0.6, 2.1), tw: rand(0, TAU), tws: rand(0.6, 2.2),
      color: pick(PALETTE.gold),
    };
  }

  function makeLeaf(initial) {
    const petal = Math.random() < 0.45;
    return {
      kind: petal ? 'petal' : 'leaf',
      x: rand(-1.15, 1.15), y: initial ? rand(-1.2, 1.1) : rand(-1.35, -1.15), z: rand(0.55, 2.2),
      vy: rand(0.045, 0.11), sway: rand(0.04, 0.12), swayF: rand(0.3, 0.9), phase: rand(0, TAU),
      rot: rand(0, TAU), rotV: rand(-0.9, 0.9), flip: rand(0, TAU), flipV: rand(0.8, 2.2),
      s: rand(5, 10),
      color: petal ? pick(PALETTE.ivory) : (Math.random() < 0.8 ? pick(PALETTE.gold) : pick(PALETTE.emerald)),
    };
  }

  function populate() {
    const area = (size.w * size.h) / 100000;
    const dustN = Math.round(Math.min(140, Math.max(24, area * (opts.dust ?? 9))));
    const leafN = Math.round(Math.min(34, Math.max(6, area * (opts.leaves ?? 2.2))));
    particles = [];
    for (let i = 0; i < dustN; i++) particles.push(makeDust(true));
    for (let i = 0; i < leafN; i++) particles.push(makeLeaf(true));
    particles.sort((a, b) => b.z - a.z); // البعيد يُرسم أولًا
  }

  function project(p, par) {
    const scale = Math.min(size.w, size.h) * 0.62 * FOCAL / p.z;
    // القريب (z صغير) يتحرك أكثر مع الميلان → عمق
    const sx = size.w / 2 + (p.x - par.x * 0.18 / p.z) * scale;
    const sy = size.h / 2 + (p.y - par.y * 0.14 / p.z) * scale;
    return { sx, sy, scale };
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    if (!visible) return;
    const par = parallaxValue();
    ctx.clearRect(0, 0, size.w, size.h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.kind === 'dust') {
        p.y += p.vy * dt; p.x += p.vx * dt; p.tw += p.tws * dt;
        if (p.y > 1.25) Object.assign(p, makeDust(false));
        const { sx, sy } = project(p, par);
        const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.tw))) * Math.min(1, 1.6 / p.z);
        const R = p.r * (1.6 / p.z) * 3.2;
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(glowSprite(p.color), sx - R, sy - R, R * 2, R * 2);
      } else {
        p.y += p.vy * dt;
        p.phase += p.swayF * dt;
        p.x += Math.sin(p.phase) * p.sway * dt;
        p.rot += p.rotV * dt;
        p.flip += p.flipV * dt;
        if (p.y > 1.3) Object.assign(p, makeLeaf(false));
        const { sx, sy, scale } = project(p, par);
        const s = p.s * (scale / 300);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip)); // دوران حول المحور → إحساس ثلاثي الأبعاد
        ctx.globalAlpha = Math.min(0.95, 1.35 / p.z) * 0.85;
        // تظليل حسب زاوية الانقلاب: وجه الورقة أفتح من ظهرها
        const shade = 0.75 + 0.25 * Math.sin(p.flip);
        ctx.fillStyle = p.color;
        if (p.kind === 'petal') petalPath(ctx, s); else leafPath(ctx, s);
        ctx.fill();
        ctx.globalAlpha *= 1 - shade * 0.6;
        ctx.strokeStyle = 'rgba(126,98,48,.55)';
        ctx.lineWidth = Math.max(0.5, s * 0.08);
        if (p.kind === 'leaf') { ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(0, s * 0.85); ctx.stroke(); }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { size = resize(); populate(); }) : null;
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 })
    : null;

  return {
    start() {
      if (running) return;
      size = resize();
      populate();
      running = true;
      last = 0;
      ro && ro.observe(canvas);
      io && io.observe(canvas);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      ro && ro.disconnect();
      io && io.disconnect();
      ctx.clearRect(0, 0, size.w, size.h);
    },
  };
}

/**
 * انفجار احتفالي من أوراق وبتلات ذهبية من نقطة على الشاشة (يُنشئ لوحة مؤقتة ثم يزيلها).
 * @param {number} x @param {number} y إحداثيات الشاشة
 */
export function celebrate(x = window.innerWidth / 2, y = window.innerHeight / 2, count = 90) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-burst';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const { ctx, resize } = setupCanvas(canvas);
  const size = resize();
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rand(-Math.PI, 0) + rand(-0.35, 0.35); // للأعلى غالبًا
    const sp = rand(260, 820);
    const kind = Math.random() < 0.35 ? 'petal' : (Math.random() < 0.5 ? 'leaf' : 'spark');
    parts.push({
      kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      rot: rand(0, TAU), rotV: rand(-8, 8), flip: rand(0, TAU), flipV: rand(4, 11),
      s: kind === 'spark' ? rand(1.5, 3.2) : rand(5, 11), life: 0, max: rand(1.8, 3.1),
      color: kind === 'petal' ? pick(PALETTE.ivory) : pick(PALETTE.gold),
    });
  }
  let last = 0;
  function frame(t) {
    const dt = Math.min(0.04, (t - (last || t)) / 1000);
    last = t;
    ctx.clearRect(0, 0, size.w, size.h);
    let alive = 0;
    for (const p of parts) {
      p.life += dt;
      if (p.life > p.max) continue;
      alive++;
      p.vx *= 1 - 1.6 * dt;
      p.vy = p.vy * (1 - 1.6 * dt) + 380 * dt; // جاذبية مع مقاومة هواء
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.rotV * dt; p.flip += p.flipV * dt;
      const fade = 1 - Math.max(0, (p.life - p.max * 0.6) / (p.max * 0.4));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      if (p.kind === 'spark') {
        const R = p.s * 4;
        ctx.drawImage(glowSprite('#FFF4D6'), -R, -R, R * 2, R * 2);
      } else {
        ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        if (p.kind === 'petal') petalPath(ctx, p.s); else leafPath(ctx, p.s);
        ctx.fill();
        ctx.strokeStyle = 'rgba(126,98,48,.45)'; ctx.lineWidth = 0.7; ctx.stroke();
      }
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame); else canvas.remove();
  }
  requestAnimationFrame(frame);
}
