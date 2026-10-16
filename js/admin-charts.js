// رسوم بيانية SVG خفيفة بدون مكتبات. كل الأرقام من admin_dashboard_stats().
// اللونان: زمردي للحضور، ذهبي للاعتذار؛ مع وسيلة إيضاح وتسميات مباشرة (الهوية ليست باللون وحده).

const SVG_NS = 'http://www.w3.org/2000/svg';
export const COLORS = { attending: '#15634B', declined: '#C2A063', guests: '#15634B' };

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function empty(container, message) {
  const p = document.createElement('p');
  p.className = 'chart__empty';
  p.textContent = message;
  container.replaceChildren(p);
}

function legend(items) {
  const ul = document.createElement('ul');
  ul.className = 'chart__legend';
  for (const { color, label } of items) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'chart__swatch';
    sw.style.background = color;
    li.append(sw, document.createTextNode(label));
    ul.append(li);
  }
  return ul;
}

const tooltip = () => document.getElementById('chart-tooltip');
function attachTooltip(target, text) {
  const show = (e) => {
    const t = tooltip();
    t.textContent = text;
    t.hidden = false;
    const x = (e.clientX ?? target.getBoundingClientRect().left) + 12;
    const y = (e.clientY ?? target.getBoundingClientRect().top) - 12;
    t.style.left = `${Math.min(x, window.innerWidth - t.offsetWidth - 8)}px`;
    t.style.top = `${Math.max(8, y - t.offsetHeight)}px`;
  };
  const hide = () => { tooltip().hidden = true; };
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointermove', show);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('focus', (e) => show({ clientX: target.getBoundingClientRect().left, clientY: target.getBoundingClientRect().top, ...e }));
  target.addEventListener('blur', hide);
  target.setAttribute('tabindex', '0');
  target.setAttribute('aria-label', text);
}

/** شريط أفقي واحد مقسوم: المؤكدون مقابل المعتذرين (عدد الردود). */
export function renderSplit(container, stats) {
  const a = Number(stats.attending_responses) || 0;
  const d = Number(stats.declined_responses) || 0;
  const total = a + d;
  if (total === 0) { empty(container, 'لا توجد ردود بعد.'); return; }

  const W = 380, H = 48, barY = 8, barH = 30, gap = 2;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart__svg', 'aria-label': `مؤكدون ${a}، معتذرون ${d}` });
  const aW = Math.round((a / total) * W);
  // RTL: نبدأ من اليمين.
  if (a > 0) {
    const r = svg('rect', { x: W - aW, y: barY, width: Math.max(0, aW - (d > 0 ? gap / 2 : 0)), height: barH, rx: 4, fill: COLORS.attending });
    attachTooltip(r, `مؤكدون: ${a} رد (${Math.round((a / total) * 100)}%)`);
    root.append(r);
  }
  if (d > 0) {
    const r = svg('rect', { x: 0, y: barY, width: Math.max(0, W - aW - (a > 0 ? gap / 2 : 0)), height: barH, rx: 4, fill: COLORS.declined });
    attachTooltip(r, `معتذرون: ${d} رد (${Math.round((d / total) * 100)}%)`);
    root.append(r);
  }
  const labels = document.createElement('div');
  labels.className = 'chart__split-labels';
  const la = document.createElement('span'); la.textContent = `سيحضر: ${a} (${Math.round((a / total) * 100)}%)`;
  const ld = document.createElement('span'); ld.textContent = `معتذر: ${d} (${Math.round((d / total) * 100)}%)`;
  labels.append(la, ld);
  container.replaceChildren(legend([{ color: COLORS.attending, label: 'مؤكدون' }, { color: COLORS.declined, label: 'معتذرون' }]), root, labels);
}

function niceMax(v) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function dayLabel(day) {
  const [, m, d] = String(day).split('-');
  return `${Number(d)}/${Number(m)}`;
}

/** أعمدة يومية مكدسة: مؤكد + معتذر. */
export function renderTimeline(container, stats) {
  const days = Array.isArray(stats.timeline) ? stats.timeline : [];
  if (days.length === 0) { empty(container, 'لا توجد ردود بعد لعرض تطورها.'); return; }

  const W = 380, H = 200, padT = 12, padB = 28, padX = 28;
  const max = niceMax(Math.max(...days.map((t) => t.attending + t.declined)));
  const plotH = H - padT - padB;
  const slot = (W - padX * 2) / days.length;
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart__svg', 'aria-label': 'عدد الردود اليومية' });

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = padT + plotH - (v / max) * plotH;
    root.append(svg('line', { x1: padX, x2: W - padX, y1: y, y2: y, class: 'chart__grid' }));
    const t = svg('text', { x: W - padX + 6, y: y + 4, class: 'chart__axis', 'text-anchor': 'start' });
    t.textContent = String(Math.round(v));
    root.append(t);
  }

  const labelEvery = Math.ceil(days.length / 6);
  days.forEach((t, i) => {
    // RTL: الأقدم على اليمين.
    const cx = W - padX - slot * (i + 0.5);
    const x = cx - barW / 2;
    const aH = (t.attending / max) * plotH;
    const dH = (t.declined / max) * plotH;
    const base = padT + plotH;
    const g = svg('g');
    if (t.attending > 0) g.append(svg('rect', { x, y: base - aH, width: barW, height: Math.max(0, aH), rx: 3, fill: COLORS.attending }));
    if (t.declined > 0) g.append(svg('rect', { x, y: base - aH - dH, width: barW, height: Math.max(0, dH - (t.attending > 0 ? 2 : 0)), rx: 3, fill: COLORS.declined }));
    const hit = svg('rect', { x: cx - slot / 2, y: padT, width: slot, height: plotH, fill: 'transparent' });
    attachTooltip(hit, `${t.day}: مؤكدون ${t.attending}، معتذرون ${t.declined}`);
    g.append(hit);
    root.append(g);
    if (i % labelEvery === 0) {
      const lbl = svg('text', { x: cx, y: H - 8, class: 'chart__axis', 'text-anchor': 'middle' });
      lbl.textContent = dayLabel(t.day);
      root.append(lbl);
    }
  });
  root.append(svg('line', { x1: padX, x2: W - padX, y1: padT + plotH, y2: padT + plotH, class: 'chart__baseline' }));
  container.replaceChildren(legend([{ color: COLORS.attending, label: 'مؤكدون' }, { color: COLORS.declined, label: 'معتذرون' }]), root);
}

/** خط تراكمي لعدد البالغين المتوقع حضورهم بحسب تاريخ الرد. */
export function renderGuests(container, stats) {
  const days = Array.isArray(stats.timeline) ? stats.timeline : [];
  const total = Number(stats.expected_guests) || 0;
  if (days.length === 0 || total === 0) { empty(container, 'لا يوجد حضور مؤكد بعد.'); return; }

  let run = 0;
  const points = days.map((t) => ({ day: t.day, value: (run += Number(t.guests) || 0) }));
  const W = 380, H = 200, padT = 24, padB = 28, padX = 28;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const plotH = H - padT - padB;
  const n = points.length;
  const xAt = (i) => (n === 1 ? W / 2 : W - padX - ((W - padX * 2) * i) / (n - 1));
  const yAt = (v) => padT + plotH - (v / max) * plotH;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart__svg', 'aria-label': `إجمالي البالغين المتوقع ${total}` });

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    root.append(svg('line', { x1: padX, x2: W - padX, y1: yAt(v), y2: yAt(v), class: 'chart__grid' }));
    const t = svg('text', { x: W - padX + 6, y: yAt(v) + 4, class: 'chart__axis', 'text-anchor': 'start' });
    t.textContent = String(Math.round(v));
    root.append(t);
  }
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');
  root.append(svg('path', { d, fill: 'none', stroke: COLORS.guests, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  points.forEach((p, i) => {
    const c = svg('circle', { cx: xAt(i), cy: yAt(p.value), r: 4.5, fill: COLORS.guests, stroke: '#fff', 'stroke-width': 2 });
    root.append(c);
    const hit = svg('circle', { cx: xAt(i), cy: yAt(p.value), r: 14, fill: 'transparent' });
    attachTooltip(hit, `${p.day}: الإجمالي التراكمي ${p.value}`);
    root.append(hit);
  });
  const last = points[points.length - 1];
  const lbl = svg('text', { x: xAt(n - 1), y: yAt(last.value) - 10, class: 'chart__value', 'text-anchor': n === 1 ? 'middle' : 'start' });
  lbl.textContent = String(last.value);
  root.append(lbl);
  const labelEvery = Math.ceil(n / 6);
  points.forEach((p, i) => {
    if (i % labelEvery !== 0) return;
    const t = svg('text', { x: xAt(i), y: H - 8, class: 'chart__axis', 'text-anchor': 'middle' });
    t.textContent = dayLabel(p.day);
    root.append(t);
  });
  container.replaceChildren(root);
}
