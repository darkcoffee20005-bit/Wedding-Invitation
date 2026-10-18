// مصدر حركة مشترك للعمق ثلاثي الأبعاد: مؤشر الفأرة على الكمبيوتر، وميلان الهاتف (الجيروسكوب) على الجوال.
// يُرجع قيمًا ناعمة بين -1 و1 تستخدمها الإمالة والجسيمات.

const state = { tx: 0, ty: 0, x: 0, y: 0, listeners: new Set(), running: false, gyro: false };

function clamp(v) { return Math.max(-1, Math.min(1, v)); }

function onPointer(e) {
  if (state.gyro || e.pointerType === 'touch') return;
  state.tx = clamp((e.clientX / window.innerWidth) * 2 - 1);
  state.ty = clamp((e.clientY / window.innerHeight) * 2 - 1);
}

function onOrientation(e) {
  if (e.gamma == null || e.beta == null) return;
  state.gyro = true;
  // gamma: يمين/يسار (-90..90)، beta: أمام/خلف (-180..180)؛ نطرح زاوية الإمساك المعتادة للهاتف (~40°)
  state.tx = clamp(e.gamma / 25);
  state.ty = clamp((e.beta - 40) / 25);
}

function loop() {
  // تنعيم أُسّي حتى تبدو الحركة كأنها في سائل
  state.x += (state.tx - state.x) * 0.06;
  state.y += (state.ty - state.y) * 0.06;
  state.listeners.forEach((fn) => fn(state.x, state.y));
  if (state.listeners.size) requestAnimationFrame(loop);
  else state.running = false;
}

export function startParallax() {
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
}

/** iOS يتطلب إذنًا للجيروسكوب، ويجب طلبه داخل نقرة المستخدم. */
export async function requestGyroPermission() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      return res === 'granted';
    }
  } catch { /* رُفض أو غير مدعوم */ }
  return true;
}

export function onParallax(fn) {
  state.listeners.add(fn);
  if (!state.running) {
    state.running = true;
    requestAnimationFrame(loop);
  }
  return () => state.listeners.delete(fn);
}

export function parallaxValue() {
  return { x: state.x, y: state.y };
}

/** إمالة ثلاثية الأبعاد لعنصر حسب موقع المؤشر فوقه (للبطاقات). */
export function attachCardTilt(el, maxDeg = 5) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let raf = 0;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.setProperty('--card-rx', `${(-py * maxDeg).toFixed(2)}deg`);
      el.style.setProperty('--card-ry', `${(px * maxDeg).toFixed(2)}deg`);
      el.style.setProperty('--glare-x', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--glare-y', `${((py + 0.5) * 100).toFixed(1)}%`);
    });
  };
  const leave = () => {
    cancelAnimationFrame(raf);
    el.style.setProperty('--card-rx', '0deg');
    el.style.setProperty('--card-ry', '0deg');
  };
  el.classList.add('tilt-card');
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
}
