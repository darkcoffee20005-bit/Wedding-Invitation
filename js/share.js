// روابط الخرائط والمشاركة ونص الدعوة.
import { CHILDREN_NOTE } from './content.js';
import { formatDateAr, formatTimeAr, formatWeekdayAr, timeZoneLabelAr } from './time-utils.js';

/** رابط الخرائط: الرابط الدقيق إن وُجد، وإلا رابط بحث باسم القاعة والعنوان (بدون إحداثيات مخترعة). */
export function buildMapsUrl(settings) {
  const url = (settings.maps_url || '').trim();
  if (/^https:\/\//i.test(url)) return url;
  const query = [settings.venue_name, settings.venue_address].filter(Boolean).join('، ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** رابط الموقع العام بدون أي رمز دعوة شخصي (حتى لا يُشارَك الرمز بالخطأ). */
export function publicSiteUrl(configuredUrl, location = globalThis.location) {
  if (configuredUrl) return configuredUrl;
  if (!location) return '';
  const u = new URL(location.href);
  u.hash = '';
  u.search = '';
  return u.toString();
}

/** فقرات نص متعدد الأسطر (كل سطر غير فارغ = فقرة). */
export function splitParagraphs(text) {
  return String(text || '').split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
}

/** نص الدعوة المستخدم في واتساب وزر النسخ (كل أجزائه من الإعدادات القابلة للتعديل). */
export function buildInvitationText(settings, startDate, siteUrl) {
  const tz = settings.timezone;
  const lines = [
    '✨ دعوة زفاف ✨',
    '',
    `${settings.intro_line || 'بكل الحب والفرح'}، يتشرف ${settings.groom_name} و${settings.bride_name} بدعوتكم لمشاركتهما فرحة حفل زفافهما.`,
    '',
    `📅 ${formatWeekdayAr(startDate, tz)} ${formatDateAr(startDate, tz)}`,
    `🕓 الساعة ${formatTimeAr(settings.event_time)} (${settings.event_time} ${timeZoneLabelAr(tz)})`,
    `📍 ${settings.venue_name} — ${settings.venue_address}`,
    `🗺️ الموقع على الخريطة: ${buildMapsUrl(settings)}`,
  ];
  if (siteUrl) lines.push(`💌 الدعوة وتأكيد الحضور: ${siteUrl}`);
  // ملاحظة الأطفال: من الإعدادات، وإلا النص الحرفي الافتراضي.
  if (settings.show_children_note !== false) {
    const title = settings.children_note_title || CHILDREN_NOTE.title;
    const paragraphs = settings.children_note_body ? splitParagraphs(settings.children_note_body) : CHILDREN_NOTE.paragraphs;
    lines.push('', `🤍 ${title}:`, ...paragraphs);
  }
  const closing = settings.share_closing_text ?? 'حضوركم يزيدنا فرحًا وشرفًا، ودمتم بخير ومحبة.';
  if (closing) lines.push('', closing);
  return lines.join('\n');
}

/** رابط واتساب: بدون رقم يفتح التطبيق ليختار المستخدم جهة الاتصال بنفسه. */
export function buildWhatsAppUrl(text, phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fallback below */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
