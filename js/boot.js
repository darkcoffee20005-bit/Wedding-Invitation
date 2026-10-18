// يُحمَّل بشكل متزامن في <head> قبل رسم الصفحة: يقرر هل يظهر مشهد الظرف،
// ويغطي الصفحة باللون الزمردي حتى لا تومض قبل ظهوره. لا يعتمد على أي وحدة أخرى.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  // الهوية اللونية: معاينة من الرابط (?theme=) أو آخر هوية محفوظة — قبل الرسم لتجنب وميض الألوان
  var THEMES = ['emerald', 'navy', 'rose-gold', 'burgundy', 'noir', 'olive', 'royal'];
  try {
    var t = new URLSearchParams(location.search).get('theme') || localStorage.getItem('wedding_theme');
    if (t && t !== 'emerald' && THEMES.indexOf(t) !== -1) root.setAttribute('data-theme', t);
  } catch (e) { /* ignore */ }
  var skip = false;
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('intro') === '0') skip = true;
    if (sessionStorage.getItem('wedding_intro_opened') === '1') skip = true;
    // آخر قيمة معروفة لإعداد "مشهد الظرف" من لوحة الإدارة
    if (localStorage.getItem('wedding_intro_enabled') === '0') skip = true;
  } catch (e) { /* التخزين غير متاح: نعرض المشهد */ }
  if (!skip) {
    root.classList.add('intro-pending');
    // أمان: إن لم يُحمَّل مشهد الظرف خلال 6 ثوانٍ لأي سبب، تظهر الصفحة كما هي.
    setTimeout(function () {
      if (!root.classList.contains('intro-ready')) root.classList.remove('intro-pending');
    }, 6000);
  }
})();
