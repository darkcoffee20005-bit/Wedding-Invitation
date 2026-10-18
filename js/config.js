// =============================================================================
// الإعدادات المركزية للواجهة.
// - SUPABASE: قيم عامة فقط (رابط المشروع والمفتاح العام anon/publishable).
//   ⚠️ لا تضع مفتاح service_role هنا أبدًا؛ هذا الملف يُرسَل لكل زائر.
// - WEDDING_DEFAULTS: تُعرض فورًا وتُستخدم إن تعذّر الاتصال بالخادم؛
//   عند نجاح الاتصال تُستبدل بالقيم المخزنة في جدول wedding_settings.
// =============================================================================
import { CHILDREN_NOTE } from './content.js';

export const SUPABASE = {
  // مثال: 'https://abcdefghijklmnop.supabase.co'
  url: '',
  // المفتاح العام (anon / publishable) من Project Settings → API. آمن للنشر.
  anonKey: '',
  // اتركه فارغًا ليُستخدم `${url}/functions/v1/rsvp` تلقائيًا.
  rsvpFunctionUrl: '',
};

export const WEDDING_DEFAULTS = {
  groom_name: 'يوسف',
  bride_name: 'شذى',
  event_date: '2027-05-27',   // YYYY-MM-DD (ميلادي)
  event_time: '16:00',        // HH:MM بنظام 24 ساعة
  timezone: 'Asia/Baghdad',   // المنطقة الزمنية للحفل (وليس منطقة جهاز الزائر)
  venue_name: 'مزرعة الفرح',
  venue_address: 'الغابات على نهر دجلة',
  maps_url: null,             // رابط دقيق (غير محدد بعد) — يُنشأ رابط بحث تلقائيًا عند غيابه
  duration_minutes: null,     // مدة الحفل غير محددة بعد
  max_guests_per_response: 15, // الحد الأعلى للبالغين في الرد الواحد (يُعدَّل من لوحة الإدارة)
  show_calendar_button: true,
  allow_open_rsvp: true,
  rsvp_open: true,

  // ---- نصوص الصفحة (كلها قابلة للتعديل من لوحة الإدارة ← إعدادات الحفل) ----
  verse_text: '﴿وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً﴾',
  intro_line: 'بكل الحب والفرح',
  tagline: 'يتشرفان بدعوتكم لمشاركتهما فرحة حفل زفافهما',
  invitation_message: 'بقلوبٍ يملؤها الفرح، وبمشاعر الامتنان لله، يسعدنا أن تكونوا معنا في يومٍ ننتظره بشوق، لنبدأ معًا فصلًا جديدًا من الحياة. حضوركم يكمل فرحتنا ويزيدها جمالًا.',
  details_title: 'موعد الفرح',
  countdown_title: 'العد التنازلي ليوم الفرح',
  countdown_done_text: 'حلّ يوم الفرح! شكرًا لمشاركتكم فرحتنا 🤍',
  actions_title: 'شاركونا الفرحة',
  rsvp_title: 'هل ستشاركوننا فرحتنا؟',
  rsvp_lead: 'يسعدنا تأكيد حضوركم لنستعد لاستقبالكم بأجمل صورة.',
  footer_text: 'بانتظاركم لنصنع معًا أجمل الذكريات',
  show_children_note: true,
  children_note_title: CHILDREN_NOTE.title,
  children_note_body: CHILDREN_NOTE.paragraphs.join('\n'),
  share_closing_text: 'حضوركم يزيدنا فرحًا وشرفًا، ودمتم بخير ومحبة.',
  whatsapp_number: null, // يُعدَّل من لوحة الإدارة (أو UI.whatsappNumber أدناه)
  site_url: null,        // يُعدَّل من لوحة الإدارة (أو UI.siteUrl أدناه)

  // ---- التجربة التفاعلية (قابلة للتعديل من لوحة الإدارة) ----
  intro_enabled: true,   // مشهد الظرف ثلاثي الأبعاد عند الفتح
  effects_enabled: true, // الغبار الذهبي والأوراق المتساقطة والإمالة ثلاثية الأبعاد
  music_enabled: true,   // موسيقى بعد فتح الظرف (مع زر كتم)
  music_url: null,       // ملف موسيقى خاص https — فارغ = لحن صندوق موسيقى يُولَّد داخل المتصفح
};

export const UI = {
  // مدة افتراضية تُستخدم فقط لملف التقويم عندما لا تكون مدة الحفل محددة.
  // ليست معلومة مؤكدة، ويُذكر ذلك في وصف الحدث.
  calendarFallbackDurationMinutes: 240,
  // رقم واتساب اختياري بصيغة دولية بدون + أو أصفار (مثال: 9647XXXXXXXXX). فارغ = يختار المستخدم جهة الاتصال.
  whatsappNumber: '',
  // رابط الموقع المنشور (يُضاف لرسالة المشاركة). فارغ = رابط الصفحة الحالية بدون رموز الدعوة.
  siteUrl: '',
  requestTimeoutMs: 15000,
};

/** يسمح بتجاوز الإعدادات وقت التشغيل (يُستخدم في الاختبارات فقط). */
const runtime = globalThis.WEDDING_RUNTIME_CONFIG || {};

export function getSupabaseConfig() {
  const cfg = { ...SUPABASE, ...(runtime.supabase || {}) };
  const url = (cfg.url || '').replace(/\/+$/, '');
  return {
    url,
    anonKey: cfg.anonKey || '',
    rsvpFunctionUrl: cfg.rsvpFunctionUrl || (url ? `${url}/functions/v1/rsvp` : ''),
  };
}

export function getUiConfig() {
  return { ...UI, ...(runtime.ui || {}) };
}

export function getWeddingDefaults() {
  return { ...WEDDING_DEFAULTS, ...(runtime.wedding || {}) };
}
