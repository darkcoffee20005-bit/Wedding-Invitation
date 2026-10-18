// بطاقة تقويم شهر الحفل: الأسبوع يبدأ بالسبت، ويوم الحفل محاط بقلب يُرسم بخط ذهبي عند ظهوره.

const WEEKDAYS = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
const HEART = 'M50 86 C 22 64, 6 48, 10 30 C 14 14, 34 8, 50 26 C 66 8, 86 14, 90 30 C 94 48, 78 64, 50 86 Z';

export function monthMatrix(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = +m[1]; const mo = +m[2]; const d = +m[3];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 1) % 7; // السبت = 0
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let i = 1; i <= days; i++) cells.push(i);
  while (cells.length % 7) cells.push(null);
  const title = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  return { year: y, month: mo, day: d, cells, title };
}

export function renderMonthCard(container, settings, { weekdayLabel = '', timeLabel = '' } = {}) {
  const data = monthMatrix(settings.event_date);
  if (!container || !data) return;
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `تقويم ${data.title}، يوم الحفل ${weekdayLabel} ${data.day}`.trim());

  const head = document.createElement('div');
  head.className = 'month-card__head';
  const title = document.createElement('p');
  title.className = 'month-card__title';
  title.textContent = data.title;
  const sub = document.createElement('p');
  sub.className = 'month-card__sub';
  sub.textContent = [weekdayLabel, timeLabel].filter(Boolean).join(' · ');
  head.append(title, sub);

  const grid = document.createElement('div');
  grid.className = 'month-card__grid';
  grid.setAttribute('aria-hidden', 'true');
  WEEKDAYS.forEach((w) => {
    const h = document.createElement('span');
    h.className = 'month-card__wd';
    h.textContent = w;
    grid.append(h);
  });
  data.cells.forEach((day) => {
    const c = document.createElement('span');
    c.className = 'month-card__day';
    if (day === null) { c.classList.add('is-empty'); grid.append(c); return; }
    c.textContent = String(day);
    if (day === data.day) {
      c.classList.add('is-event');
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 96');
      svg.setAttribute('class', 'month-card__heart');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', HEART);
      path.setAttribute('pathLength', '100');
      svg.append(path);
      c.append(svg);
    }
    grid.append(c);
  });
  container.replaceChildren(head, grid);
}
