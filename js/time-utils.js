// أدوات الوقت والمنطقة الزمنية (بدون مكتبات خارجية، تعتمد على Intl).
// المبدأ: نحوّل "تاريخ + وقت محلي في منطقة الحفل" إلى لحظة UTC مطلقة،
// ثم نحسب الفرق من Date.now() في كل تحديث. منطقة جهاز الزائر لا تؤثر.

const dtfCache = new Map();
function partsFormatter(timeZone) {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(timeZone);
}

/** فرق المنطقة الزمنية عن UTC (بالملي ثانية) عند لحظة معينة. */
export function timeZoneOffsetMs(date, timeZone) {
  const p = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - wholeSeconds;
}

/** "2027-05-27" + "16:00" في "Asia/Baghdad" → Date (لحظة UTC مطلقة). */
export function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr));
  if (!dm || !tm) throw new Error('Invalid date/time format');
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], +(tm[3] || 0));
  const offset1 = timeZoneOffsetMs(new Date(guess), timeZone);
  let result = guess - offset1;
  // تصحيح ثانٍ لحالات التوقيت الصيفي حول الحدود.
  const offset2 = timeZoneOffsetMs(new Date(result), timeZone);
  if (offset2 !== offset1) result = guess - offset2;
  return new Date(result);
}

/** أجزاء العد التنازلي؛ لا تكون سالبة أبدًا. */
export function countdownParts(targetMs, nowMs) {
  const diff = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(diff / 1000);
  return {
    done: diff <= 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

const AR_LOCALE = 'ar-u-ca-gregory-nu-latn';

/** "الخميس" */
export function formatWeekdayAr(startDate, timeZone) {
  return new Intl.DateTimeFormat(AR_LOCALE, { weekday: 'long', timeZone }).format(startDate);
}

/** "27 مايو 2027" */
export function formatDateAr(startDate, timeZone) {
  return new Intl.DateTimeFormat(AR_LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(startDate);
}

/** "16:00" → "4:00 عصرًا" */
export function formatTimeAr(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  let period;
  if (h >= 5 && h < 12) period = 'صباحًا';
  else if (h >= 12 && h < 15) period = 'ظهرًا';
  else if (h >= 15 && h < 18) period = 'عصرًا';
  else if (h >= 18) period = 'مساءً';
  else period = 'ليلًا';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const TZ_NAMES_AR = { 'Asia/Baghdad': 'بتوقيت بغداد' };
export function timeZoneLabelAr(timeZone) {
  return TZ_NAMES_AR[timeZone] || `بتوقيت ${timeZone}`;
}

/** تنسيق تاريخ ووقت لعرضه في لوحة الإدارة. */
export function formatDateTimeAr(value, timeZone) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(AR_LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
  }).format(d);
}
