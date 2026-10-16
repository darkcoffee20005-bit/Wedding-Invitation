// إنشاء ملف تقويم ICS (RFC 5545) ورابط Google Calendar.
// الأوقات تُكتب بتوقيت UTC (لاحقة Z) فتظهر صحيحة في أي تقويم وأي منطقة زمنية.

function pad(n) { return String(n).padStart(2, '0'); }

export function formatIcsUtc(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
         `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function escapeIcsText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** طي الأسطر عند 75 بايت UTF-8 دون كسر الأحرف متعددة البايت. */
export function foldIcsLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (currentBytes + b > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // الأسطر التالية تبدأ بمسافة
    }
    current += ch;
    currentBytes += b;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * @param {{title:string, description:string, location:string, start:Date, durationMinutes:number, uid:string, url?:string, now?:Date}} ev
 */
export function buildIcs(ev) {
  const end = new Date(ev.start.getTime() + ev.durationMinutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Invitation//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${formatIcsUtc(ev.now || new Date())}`,
    `DTSTART:${formatIcsUtc(ev.start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `LOCATION:${escapeIcsText(ev.location)}`,
    `DESCRIPTION:${escapeIcsText(ev.description)}`,
  ];
  if (ev.url) lines.push(`URL:${ev.url}`);
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT3H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(ev.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(ev) {
  const end = new Date(ev.start.getTime() + ev.durationMinutes * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${formatIcsUtc(ev.start)}/${formatIcsUtc(end)}`,
    details: ev.description,
    location: ev.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
