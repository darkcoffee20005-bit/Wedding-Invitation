// هويات الألوان المتاحة (التعريف الكامل للألوان في css/themes.css).
// swatch: ألوان المعاينة في لوحة الإدارة فقط.
export const THEMES = Object.freeze([
  { id: 'emerald', name: 'زمردي ملكي', swatch: ['#0B3D2E', '#C2A063', '#FBF7EE'] },
  { id: 'navy', name: 'كحلي ليلي', swatch: ['#10264A', '#C2A063', '#FAF8F3'] },
  { id: 'rose-gold', name: 'وردي ذهبي', swatch: ['#4E1F2E', '#D4A08A', '#FCF6F3'] },
  { id: 'burgundy', name: 'عنابي', swatch: ['#46101C', '#C2A063', '#FBF6EF'] },
  { id: 'noir', name: 'أسود ذهبي', swatch: ['#1A1A1A', '#CFAE62', '#F8F5EE'] },
  { id: 'olive', name: 'زيتوني', swatch: ['#2F3B28', '#C2A063', '#F9F7F0'] },
  { id: 'royal', name: 'بنفسجي ملكي', swatch: ['#281A44', '#C2A063', '#FAF8F4'] },
]);

export const DEFAULT_THEME = 'emerald';
const THEME_KEY = 'wedding_theme';

export function isTheme(id) {
  return THEMES.some((t) => t.id === id);
}

/** معاينة هوية عبر الرابط: ?theme=navy (للعرض على القاعات دون تغيير الإعدادات). */
export function previewTheme(location = globalThis.location) {
  try {
    const id = new URLSearchParams(location.search).get('theme');
    return isTheme(id) ? id : null;
  } catch {
    return null;
  }
}

export function applyTheme(id, root = document.documentElement) {
  const theme = isTheme(id) ? id : DEFAULT_THEME;
  if (theme === DEFAULT_THEME) delete root.dataset.theme; else root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const c = getComputedStyle(root).getPropertyValue('--emerald-800').trim();
    if (c) meta.setAttribute('content', c);
  }
  return theme;
}

/** حفظ آخر هوية معروفة حتى تُطبَّق فورًا في الزيارة التالية (بلا وميض بالألوان الافتراضية). */
export function rememberTheme(id) {
  try { localStorage.setItem(THEME_KEY, isTheme(id) ? id : DEFAULT_THEME); } catch { /* ignore */ }
}
