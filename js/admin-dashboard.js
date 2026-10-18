// لوحة التحكم الإدارية: الإحصائيات، الردود، الدعوات، الإعدادات، السجل، التصدير.
// كل عملية تُنفَّذ فعليًا على قاعدة البيانات؛ RLS ودوال is_admin() ترفض أي مستخدم غير مدير.
import { getSupabase, isSupabaseConfigured, isAuthError, isForbiddenError } from './supabase-client.js';
import { getCurrentSession, checkIsAdmin, signIn, signOut, onAuthChange } from './admin-auth.js';
import { renderSplit, renderTimeline, renderGuests } from './admin-charts.js';
import { toCsv } from './csv.js';
import { downloadTextFile } from './calendar.js';
import { formatDateTimeAr } from './time-utils.js';
import { buildWhatsAppUrl, copyText } from './share.js';
import { getUiConfig } from './config.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 20;
const RESPONSE_COLUMNS = 'id,guest_name,attendance,guest_count,message,source,invitation_id,created_at,updated_at';

const state = {
  user: null,
  settings: null,
  page: 0,
  total: 0,
  search: '',
  filter: '',
  sort: { column: 'created_at', ascending: false },
  rows: [],
  editingId: null,
  loadingResponses: false,
};

const ATTENDANCE_AR = { attending: 'سيحضر', declined: 'معتذر' };
const SOURCE_AR = { invitation: 'دعوة شخصية', open: 'الرابط العام', admin: 'أُضيف يدويًا' };
const ACTION_AR = {
  rsvp_insert: 'إضافة رد', rsvp_update: 'تعديل رد', rsvp_delete: 'حذف رد',
  settings_update: 'تعديل الإعدادات',
  invitation_create: 'إنشاء دعوة', invitation_update: 'تعديل دعوة', invitation_delete: 'حذف دعوة',
  invitation_token_regenerate: 'إصدار رابط جديد',
};

// ------------------------------------------------------------ أدوات عامة
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

function tz() { return state.settings?.timezone || 'Asia/Baghdad'; }
function fmt(dt) { return formatDateTimeAr(dt, tz()); }

let toastTimer;
function toast(message, isError = false) {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('toast--error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function showView(id) {
  for (const v of ['view-loading', 'view-config', 'view-login', 'view-forbidden', 'view-dashboard']) $(v).hidden = v !== id;
  $('user-box').hidden = id !== 'view-dashboard';
}

function friendlyError(error, fallback = 'تعذّرت العملية. حاول مرة أخرى.') {
  if (!error) return fallback;
  const msg = String(error.message || '');
  if (msg.includes('guest_count_exceeds_limit')) return 'عدد الحضور أكبر من الحد المسموح لهذا الرد.';
  if (error.code === '23514') return 'القيم المدخلة غير صالحة (تحقّق من الاسم والعدد وحالة الحضور).';
  if (error.code === '23502') return 'يوجد حقل مطلوب فارغ.';
  if (msg.includes('invalid_timezone')) return 'المنطقة الزمنية غير صحيحة (مثال صحيح: Asia/Baghdad).';
  if (isForbiddenError(error)) return 'ليست لديك صلاحية لتنفيذ هذه العملية.';
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network')) return 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت.';
  return fallback;
}

/** يعالج انتهاء الجلسة/سحب الصلاحية لأي عملية. يعيد true إن تمت المعالجة. */
async function handleAuthFailure(error) {
  if (isAuthError(error)) {
    await signOut();
    showLogin('انتهت الجلسة. يرجى تسجيل الدخول مجددًا.');
    return true;
  }
  if (isForbiddenError(error)) {
    const stillAdmin = await checkIsAdmin().catch(() => false);
    if (!stillAdmin) {
      await signOut();
      showView('view-forbidden');
      return true;
    }
  }
  return false;
}

async function run(promise, fallbackMessage) {
  const { data, error, count } = await promise;
  if (error) {
    if (!(await handleAuthFailure(error))) toast(friendlyError(error, fallbackMessage), true);
    throw error;
  }
  return { data, count };
}

// ------------------------------------------------------------ نوافذ الحوار
function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));

function confirmAction(title, text, okLabel = 'تأكيد', danger = true) {
  return new Promise((resolve) => {
    const d = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    const done = (v) => { ok.removeEventListener('click', onOk); d.removeEventListener('close', onClose); closeDialog(d); resolve(v); };
    const onOk = () => done(true);
    const onClose = () => done(false);
    ok.addEventListener('click', onOk);
    d.addEventListener('close', onClose);
    openDialog(d);
  });
}

// ------------------------------------------------------------ المصادقة
function showLogin(notice = '') {
  state.user = null;
  $('login-notice').textContent = notice;
  $('login-notice').hidden = !notice;
  $('login-error').hidden = true;
  $('login-password').value = '';
  showView('view-login');
  $('login-email').focus();
}

async function enterDashboard(session) {
  showView('view-loading');
  let admin = false;
  try {
    admin = await checkIsAdmin();
  } catch (error) {
    if (isAuthError(error)) { await signOut(); showLogin('انتهت الجلسة. يرجى تسجيل الدخول مجددًا.'); return; }
    showLogin('تعذّر التحقق من الصلاحيات. تحقّق من الاتصال.');
    return;
  }
  if (!admin) {
    await signOut();
    showView('view-forbidden');
    return;
  }
  state.user = session.user;
  $('user-email').textContent = session.user.email || '';
  showView('view-dashboard');
  await loadSettings().catch(() => {});
  await refreshAll();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-submit');
  if (btn.disabled) return;
  const email = $('login-email').value;
  const password = $('login-password').value;
  const err = $('login-error');
  if (!email.trim() || !password) {
    err.textContent = 'يرجى إدخال البريد وكلمة المرور.';
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.classList.add('is-loading');
  err.hidden = true;
  try {
    const session = await signIn(email, password);
    await enterDashboard(session);
  } catch (error) {
    err.textContent = error.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
});

$('logout-btn').addEventListener('click', async () => {
  await signOut();
  showLogin('تم تسجيل الخروج.');
});
$('forbidden-back').addEventListener('click', () => showLogin());

// ------------------------------------------------------------ التبويبات
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  });
  if (tab.id === 'tab-invitations') loadInvitations().catch(() => {});
  // لا تُستبدل تعديلات لم تُحفظ بعد بالقيم القادمة من الخادم.
  if (tab.id === 'tab-settings') loadSettings().then((st) => { if (!settingsDirty) fillSettingsForm(st); }).catch(() => {});
  if (tab.id === 'tab-audit') loadAudit().catch(() => {});
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    // RTL: السهم الأيسر = التالي
    const dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!dir) return;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

// ------------------------------------------------------------ الإحصائيات
async function loadStats() {
  const sb = getSupabase();
  const { data } = await run(sb.rpc('admin_dashboard_stats'), 'تعذّر تحميل الإحصائيات.');
  const s = data;
  const set = (k, v) => document.querySelectorAll(`[data-stat="${k}"]`).forEach((n) => { n.textContent = v; });
  set('total_responses', s.total_responses);
  set('attending_responses', s.attending_responses);
  set('declined_responses', s.declined_responses);
  set('expected_guests', s.expected_guests);
  set('average_guests_per_attending', s.average_guests_per_attending == null ? '—' : Number(s.average_guests_per_attending).toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 }));
  const pendingCard = $('stat-pending');
  pendingCard.hidden = s.invitations_pending == null;
  if (s.invitations_pending != null) {
    set('invitations_pending', s.invitations_pending);
    $('stat-pending-hint').textContent = `من أصل ${s.invitations_total} دعوة شخصية فعالة`;
  }
  renderSplit($('chart-split'), s);
  renderTimeline($('chart-timeline'), s);
  renderGuests($('chart-guests'), s);
  return s;
}

// ------------------------------------------------------------ الردود
function escapeLike(v) { return v.replace(/[\\%_]/g, (m) => `\\${m}`); }

function responsesQuery(sb, { withRange = true } = {}) {
  let q = sb.from('rsvp_responses').select(RESPONSE_COLUMNS, { count: 'exact' });
  if (state.search) q = q.ilike('guest_name', `%${escapeLike(state.search)}%`);
  if (state.filter) q = q.eq('attendance', state.filter);
  q = q.order(state.sort.column, { ascending: state.sort.ascending }).order('id', { ascending: true });
  if (withRange) q = q.range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);
  return q;
}

async function loadResponses() {
  const sb = getSupabase();
  state.loadingResponses = true;
  $('responses-table').setAttribute('aria-busy', 'true');
  try {
    const { data, count } = await run(responsesQuery(sb), 'تعذّر تحميل الردود.');
    state.rows = data || [];
    state.total = count ?? state.rows.length;
    const maxPage = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
    if (state.page > maxPage) { state.page = maxPage; return loadResponses(); }
    renderResponses();
  } finally {
    state.loadingResponses = false;
    $('responses-table').removeAttribute('aria-busy');
  }
}

function badge(attendance) {
  return el('span', { class: `badge badge--${attendance}`, text: ATTENDANCE_AR[attendance] || attendance });
}

function renderResponses() {
  const body = $('responses-body');
  body.replaceChildren(...state.rows.map((r) => el('tr', {}, [
    el('td', { class: 'td-name', text: r.guest_name }),
    el('td', {}, badge(r.attendance)),
    el('td', { class: 'td-num', text: String(r.guest_count) }),
    el('td', { class: 'td-message', text: r.message || '—', title: r.message || '' }),
    el('td', { class: 'td-date', text: fmt(r.created_at) }),
    el('td', { class: 'td-date', text: fmt(r.updated_at) }),
    el('td', { class: 'td-actions' }, [
      el('button', { type: 'button', class: 'btn btn--xs', text: 'تفاصيل', 'aria-label': `تفاصيل رد ${r.guest_name}`, onclick: () => showDetails(r) }),
      el('button', { type: 'button', class: 'btn btn--xs', text: 'تعديل', 'aria-label': `تعديل رد ${r.guest_name}`, onclick: () => openEdit(r) }),
      el('button', { type: 'button', class: 'btn btn--xs btn--danger-outline', text: 'حذف', 'aria-label': `حذف رد ${r.guest_name}`, onclick: () => deleteResponse(r) }),
    ]),
  ])));

  const emptyEl = $('responses-empty');
  emptyEl.hidden = state.rows.length > 0;
  emptyEl.textContent = state.search || state.filter
    ? 'لا توجد ردود مطابقة للبحث أو التصفية.'
    : 'لا توجد ردود مسجلة بعد. ستظهر هنا فور إرسال المدعوين لتأكيداتهم.';

  const from = state.total === 0 ? 0 : state.page * PAGE_SIZE + 1;
  const to = Math.min(state.total, (state.page + 1) * PAGE_SIZE);
  $('page-info').textContent = `عرض ${from}–${to} من ${state.total} رد`;
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = to >= state.total;

  document.querySelectorAll('.th-sort').forEach((b) => {
    const active = b.dataset.sort === state.sort.column;
    b.closest('th').setAttribute('aria-sort', active ? (state.sort.ascending ? 'ascending' : 'descending') : 'none');
  });
}

function showDetails(r) {
  const rows = [
    ['اسم المدعو', r.guest_name],
    ['حالة الحضور', ATTENDANCE_AR[r.attendance]],
    ['عدد البالغين', String(r.guest_count)],
    ['الرسالة', r.message || '—'],
    ['مصدر الرد', SOURCE_AR[r.source] || r.source],
    ['وقت الإرسال', fmt(r.created_at)],
    ['آخر تعديل', fmt(r.updated_at)],
  ];
  $('details-list').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  openDialog($('details-dialog'));
}

const editForm = $('edit-form');
function syncEditCount() {
  const attending = editForm.attendance.value === 'attending';
  $('edit-count-field').hidden = !attending;
}
editForm.addEventListener('change', syncEditCount);

function openEdit(r) {
  state.editingId = r ? r.id : null;
  $('edit-title').textContent = r ? 'تعديل الرد' : 'إضافة رد يدوي (مثلًا رد عبر الهاتف)';
  editForm.guest_name.value = r ? r.guest_name : '';
  editForm.querySelectorAll('input[name="attendance"]').forEach((x) => { x.checked = r ? x.value === r.attendance : false; });
  editForm.guest_count.value = r && r.attendance === 'attending' ? r.guest_count : 1;
  editForm.guest_count.max = String(state.settings?.max_guests_per_response ?? 50);
  editForm.message.value = r?.message || '';
  $('edit-error').hidden = true;
  syncEditCount();
  openDialog($('edit-dialog'));
  editForm.guest_name.focus();
}

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('edit-submit');
  if (btn.disabled) return;
  const errBox = $('edit-error');
  const name = editForm.guest_name.value.replace(/\s+/g, ' ').trim();
  const attendance = editForm.attendance.value;
  const countRaw = String(editForm.guest_count.value).trim();
  const message = editForm.message.value.trim();
  let error = '';
  if ([...name].length < 2 || [...name].length > 80) error = 'الاسم يجب أن يكون من 2 إلى 80 حرفًا.';
  else if (attendance !== 'attending' && attendance !== 'declined') error = 'اختر حالة الحضور.';
  else if (attendance === 'attending' && (!/^\d+$/.test(countRaw) || Number(countRaw) < 1)) error = 'عدد البالغين يجب أن يكون عددًا صحيحًا ≥ 1.';
  else if ([...message].length > 500) error = 'الرسالة أطول من 500 حرف.';
  if (error) { errBox.textContent = error; errBox.hidden = false; return; }

  const payload = {
    guest_name: name,
    attendance,
    guest_count: attendance === 'attending' ? Number(countRaw) : 0,
    message: message || null,
  };
  btn.disabled = true;
  try {
    const sb = getSupabase();
    let res;
    if (state.editingId) {
      res = await sb.from('rsvp_responses').update(payload).eq('id', state.editingId).select('id');
    } else {
      res = await sb.from('rsvp_responses').insert({ ...payload, source: 'admin' }).select('id');
    }
    if (res.error) {
      if (await handleAuthFailure(res.error)) return;
      errBox.textContent = friendlyError(res.error, 'تعذّر الحفظ.');
      errBox.hidden = false;
      return;
    }
    if (!res.data || res.data.length === 0) {
      errBox.textContent = 'لم يُحفظ أي تغيير (ربما حُذف الرد أو لا تملك الصلاحية).';
      errBox.hidden = false;
      return;
    }
    closeDialog($('edit-dialog'));
    toast(state.editingId ? 'تم تعديل الرد.' : 'تمت إضافة الرد.');
    await refreshAll();
  } finally {
    btn.disabled = false;
  }
});

async function deleteResponse(r) {
  const ok = await confirmAction('حذف الرد', `هل أنت متأكد من حذف رد «${r.guest_name}»؟ لا يمكن التراجع عن هذه العملية.`, 'حذف نهائي');
  if (!ok) return;
  const sb = getSupabase();
  try {
    const { data } = await run(sb.from('rsvp_responses').delete().eq('id', r.id).select('id'), 'تعذّر حذف الرد.');
    if (!data || data.length === 0) { toast('لم يُحذف أي رد.', true); return; }
    toast('تم حذف الرد.');
    await refreshAll();
  } catch { /* تمت معالجة الخطأ */ }
}

async function refreshAll() {
  await Promise.allSettled([loadStats(), loadResponses()]);
}

let searchTimer;
$('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim().slice(0, 80);
    state.page = 0;
    loadResponses().catch(() => {});
  }, 300);
});
$('filter-select').addEventListener('change', (e) => { state.filter = e.target.value; state.page = 0; loadResponses().catch(() => {}); });
$('sort-select').addEventListener('change', (e) => {
  const [column, dir] = e.target.value.split('.');
  state.sort = { column, ascending: dir === 'asc' };
  state.page = 0;
  loadResponses().catch(() => {});
});
document.querySelectorAll('.th-sort').forEach((b) => b.addEventListener('click', () => {
  const column = b.dataset.sort;
  state.sort = state.sort.column === column ? { column, ascending: !state.sort.ascending } : { column, ascending: column === 'guest_name' };
  const opt = `${state.sort.column}.${state.sort.ascending ? 'asc' : 'desc'}`;
  const sel = $('sort-select');
  if ([...sel.options].some((o) => o.value === opt)) sel.value = opt;
  state.page = 0;
  loadResponses().catch(() => {});
}));
$('prev-page').addEventListener('click', () => { if (state.page > 0) { state.page--; loadResponses().catch(() => {}); } });
$('next-page').addEventListener('click', () => { state.page++; loadResponses().catch(() => {}); });
$('refresh-btn').addEventListener('click', async () => { await refreshAll(); toast('تم تحديث البيانات.'); });
$('add-response-btn').addEventListener('click', () => openEdit(null));

// ------------------------------------------------------------ التصدير
$('export-btn').addEventListener('click', async () => {
  const ok = await confirmAction(
    'تصدير الردود',
    'يحتوي الملف على أسماء المدعوين ورسائلهم. احفظه في مكان آمن ولا تشاركه علنًا. سيُصدَّر كامل الردود وفق التصفية الحالية.',
    'تصدير', false,
  );
  if (!ok) return;
  const sb = getSupabase();
  const all = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data } = await run(responsesQuery(sb, { withRange: false }).range(from, from + 999), 'تعذّر التصدير.');
      all.push(...data);
      if (data.length < 1000) break;
    }
  } catch { return; }
  const csv = toCsv(all, [
    { key: 'guest_name', label: 'اسم المدعو' },
    { key: 'attendance', label: 'حالة الحضور', format: (v) => ATTENDANCE_AR[v] || v },
    { key: 'guest_count', label: 'عدد البالغين' },
    { key: 'message', label: 'الرسالة' },
    { key: 'source', label: 'مصدر الرد', format: (v) => SOURCE_AR[v] || v },
    { key: 'created_at', label: 'وقت الإرسال', format: (v) => fmt(v) },
    { key: 'updated_at', label: 'آخر تعديل', format: (v) => fmt(v) },
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`rsvp-responses-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  toast(`تم تصدير ${all.length} رد.`);
});

// ------------------------------------------------------------ الدعوات الشخصية
function siteBaseUrl() {
  const configured = state.settings?.site_url || getUiConfig().siteUrl;
  if (configured) return configured.replace(/#.*$/, '');
  return new URL('../', window.location.href).toString();
}

function showInvitationLink(label, token) {
  const link = `${siteBaseUrl()}#i=${token}`;
  $('link-for').textContent = `رابط دعوة: ${label}`;
  $('link-value').value = link;
  const text = `السلام عليكم ${label}،\nيسعدنا دعوتكم لحضور حفل زفافنا. تفاصيل الدعوة وتأكيد الحضور عبر الرابط الخاص بكم:\n${link}`;
  $('link-whatsapp').href = buildWhatsAppUrl(text, '');
  openDialog($('link-dialog'));
  $('link-value').select();
}
$('link-copy').addEventListener('click', async () => {
  const ok = await copyText($('link-value').value);
  toast(ok ? 'تم نسخ الرابط.' : 'تعذّر النسخ؛ انسخه يدويًا.', !ok);
});
$('link-dialog').addEventListener('close', () => { $('link-value').value = ''; });

$('invitation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('inv-submit');
  if (btn.disabled) return;
  const errBox = $('inv-error');
  const label = $('inv-label').value.replace(/\s+/g, ' ').trim();
  const maxRaw = $('inv-max').value.trim();
  const notes = $('inv-notes').value.trim();
  let error = '';
  if (!label || label.length > 120) error = 'يرجى كتابة اسم المدعو (حتى 120 حرفًا).';
  else if (maxRaw && (!/^\d+$/.test(maxRaw) || Number(maxRaw) < 1 || Number(maxRaw) > 50)) error = 'الحد الخاص يجب أن يكون عددًا صحيحًا بين 1 و50.';
  if (error) { errBox.textContent = error; errBox.hidden = false; return; }
  errBox.hidden = true;
  btn.disabled = true;
  try {
    const sb = getSupabase();
    const { data } = await run(sb.rpc('admin_create_invitation', {
      p_guest_label: label, p_max_guests: maxRaw ? Number(maxRaw) : null, p_notes: notes || null,
    }), 'تعذّر إنشاء الدعوة.');
    e.target.reset();
    showInvitationLink(label, data.token);
    await Promise.allSettled([loadInvitations(), loadStats()]);
  } catch { /* handled */ } finally {
    btn.disabled = false;
  }
});

async function loadInvitations() {
  const sb = getSupabase();
  const { data } = await run(
    sb.from('invitations')
      .select('id,guest_label,max_guests,notes,revoked_at,created_at,rsvp_responses(attendance,guest_count)')
      .order('created_at', { ascending: false }),
    'تعذّر تحميل الدعوات.',
  );
  const rows = data || [];
  const defMax = state.settings?.max_guests_per_response;
  $('invitations-body').replaceChildren(...rows.map((inv) => {
    const resp = Array.isArray(inv.rsvp_responses) ? inv.rsvp_responses[0] : inv.rsvp_responses;
    const respCell = resp
      ? el('span', {}, [badge(resp.attendance), resp.attendance === 'attending' ? ` (${resp.guest_count})` : ''])
      : el('span', { class: 'muted', text: 'لم يرد بعد' });
    return el('tr', {}, [
      el('td', { class: 'td-name', text: inv.guest_label, title: inv.notes || '' }),
      el('td', { class: 'td-num', text: inv.max_guests ? String(inv.max_guests) : `${defMax ?? '—'} (افتراضي)` }),
      el('td', {}, respCell),
      el('td', {}, el('span', { class: `badge ${inv.revoked_at ? 'badge--muted' : 'badge--active'}`, text: inv.revoked_at ? 'ملغاة' : 'فعالة' })),
      el('td', { class: 'td-date', text: fmt(inv.created_at) }),
      el('td', { class: 'td-actions' }, [
        el('button', { type: 'button', class: 'btn btn--xs', text: 'رابط جديد', onclick: () => regenerateInvitation(inv) }),
        el('button', { type: 'button', class: 'btn btn--xs', text: inv.revoked_at ? 'إعادة تفعيل' : 'إلغاء', onclick: () => toggleRevoke(inv) }),
        el('button', { type: 'button', class: 'btn btn--xs btn--danger-outline', text: 'حذف', onclick: () => deleteInvitation(inv) }),
      ]),
    ]);
  }));
  $('invitations-empty').hidden = rows.length > 0;
}

async function regenerateInvitation(inv) {
  const ok = await confirmAction('إصدار رابط جديد', `سيتوقف الرابط القديم لـ «${inv.guest_label}» عن العمل فورًا، ويبقى أي رد سابق محفوظًا. متابعة؟`, 'إصدار رابط', false);
  if (!ok) return;
  try {
    const { data } = await run(getSupabase().rpc('admin_regenerate_invitation_token', { p_invitation_id: inv.id }), 'تعذّر إصدار رابط جديد.');
    showInvitationLink(inv.guest_label, data.token);
    await loadInvitations();
  } catch { /* handled */ }
}

async function toggleRevoke(inv) {
  const revoking = !inv.revoked_at;
  if (revoking) {
    const ok = await confirmAction('إلغاء الدعوة', `لن يتمكن رابط «${inv.guest_label}» من الرد أو التعديل بعد الإلغاء. الرد السابق (إن وجد) يبقى محفوظًا.`, 'إلغاء الدعوة');
    if (!ok) return;
  }
  try {
    await run(getSupabase().from('invitations').update({ revoked_at: revoking ? new Date().toISOString() : null }).eq('id', inv.id), 'تعذّر تحديث الدعوة.');
    toast(revoking ? 'تم إلغاء الدعوة.' : 'تمت إعادة تفعيل الدعوة.');
    await Promise.allSettled([loadInvitations(), loadStats()]);
  } catch { /* handled */ }
}

async function deleteInvitation(inv) {
  const ok = await confirmAction('حذف الدعوة', `حذف دعوة «${inv.guest_label}» نهائيًا؟ أي رد مرتبط بها يبقى في قائمة الردود لكن دون ربط بالدعوة.`, 'حذف نهائي');
  if (!ok) return;
  try {
    await run(getSupabase().from('invitations').delete().eq('id', inv.id), 'تعذّر حذف الدعوة.');
    toast('تم حذف الدعوة.');
    await Promise.allSettled([loadInvitations(), loadStats()]);
  } catch { /* handled */ }
}
$('inv-refresh').addEventListener('click', () => loadInvitations().catch(() => {}));

// ------------------------------------------------------------ الإعدادات
async function loadSettings() {
  const { data } = await run(getSupabase().from('wedding_settings').select('*').eq('id', 1).maybeSingle(), 'تعذّر تحميل الإعدادات.');
  state.settings = data;
  return data;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// حقول الإعدادات: نوعها وحدودها (نفس قيود قاعدة البيانات).
const SETTINGS_TEXT = {
  groom_name: { label: 'اسم العريس', required: true, max: 60 },
  bride_name: { label: 'اسم العروس', required: true, max: 60 },
  venue_name: { label: 'اسم القاعة', required: true, max: 120 },
  venue_address: { label: 'العنوان', required: true, max: 250 },
  timezone: { label: 'المنطقة الزمنية', required: true, max: 64 },
  maps_url: { label: 'رابط الخرائط', max: 1000, https: true },
  verse_text: { label: 'العبارة الافتتاحية', max: 400 },
  intro_line: { label: 'السطر فوق الأسماء', max: 120 },
  tagline: { label: 'السطر تحت الأسماء', max: 200 },
  invitation_message: { label: 'نص الدعوة', max: 1000 },
  details_title: { label: 'عنوان قسم الموعد', required: true, max: 80 },
  countdown_title: { label: 'عنوان العد التنازلي', required: true, max: 80 },
  countdown_done_text: { label: 'رسالة حلول الموعد', required: true, max: 200 },
  actions_title: { label: 'عنوان قسم المشاركة', required: true, max: 80 },
  rsvp_title: { label: 'عنوان نموذج الرد', required: true, max: 120 },
  rsvp_lead: { label: 'النص تحت عنوان النموذج', max: 300 },
  footer_text: { label: 'عبارة التذييل', max: 200 },
  children_note_title: { label: 'عنوان ملاحظة الأطفال', required: true, max: 120 },
  children_note_body: { label: 'نص ملاحظة الأطفال', max: 1000 },
  share_closing_text: { label: 'العبارة الختامية', max: 300 },
  site_url: { label: 'رابط الموقع', max: 300, https: true },
  whatsapp_number: { label: 'رقم واتساب', max: 30 },
  music_url: { label: 'رابط الموسيقى', max: 500, https: true },
};
const SETTINGS_BOOL = ['rsvp_open', 'allow_open_rsvp', 'show_calendar_button', 'show_children_note', 'intro_enabled', 'effects_enabled', 'music_enabled'];

let settingsDirty = false;
$('settings-form').addEventListener('input', () => { settingsDirty = true; });
$('settings-form').addEventListener('change', () => { settingsDirty = true; });

function fillSettingsForm(s) {
  if (!s) return;
  settingsDirty = false;
  const f = $('settings-form');
  for (const k of Object.keys(SETTINGS_TEXT)) if (f[k]) f[k].value = s[k] ?? '';
  f.event_date.value = s.event_date || '';
  f.event_time.value = String(s.event_time || '').slice(0, 5);
  f.duration_minutes.value = s.duration_minutes ?? '';
  f.max_guests_per_response.value = s.max_guests_per_response ?? '';
  f.rsvp_deadline.value = toLocalInput(s.rsvp_deadline);
  for (const k of SETTINGS_BOOL) f[k].checked = Boolean(s[k]);
}

$('settings-reset').addEventListener('click', () => {
  fillSettingsForm(state.settings);
  $('settings-error').hidden = true;
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('settings-submit');
  const errBox = $('settings-error');
  if (btn.disabled) return;

  const payload = {};
  const errors = [];
  for (const [k, rule] of Object.entries(SETTINGS_TEXT)) {
    const v = f[k].value.trim();
    if (rule.required && !v) errors.push(`${rule.label} مطلوب.`);
    else if ([...v].length > rule.max) errors.push(`${rule.label}: الحد الأقصى ${rule.max} حرفًا.`);
    else if (rule.https && v && !/^https:\/\//i.test(v)) errors.push(`${rule.label} يجب أن يبدأ بـ https://`);
    payload[k] = v || null;
  }
  if (payload.whatsapp_number) {
    payload.whatsapp_number = payload.whatsapp_number.replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(payload.whatsapp_number)) errors.push('رقم واتساب يجب أن يكون بالصيغة الدولية (8–15 رقمًا) مثل 9647XXXXXXXXX.');
  }
  payload.event_date = f.event_date.value.trim();
  payload.event_time = f.event_time.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.event_date) || !/^\d{2}:\d{2}$/.test(payload.event_time)) errors.push('التاريخ أو الوقت غير صحيح.');
  const dur = f.duration_minutes.value.trim();
  payload.duration_minutes = dur ? Number(dur) : null;
  if (payload.duration_minutes !== null && (!Number.isInteger(payload.duration_minutes) || payload.duration_minutes < 15 || payload.duration_minutes > 1440)) errors.push('مدة الحفل بين 15 و1440 دقيقة.');
  payload.max_guests_per_response = Number(f.max_guests_per_response.value);
  if (!Number.isInteger(payload.max_guests_per_response) || payload.max_guests_per_response < 1 || payload.max_guests_per_response > 50) errors.push('الحد الأعلى للبالغين بين 1 و50.');
  const deadline = f.rsvp_deadline.value.trim();
  payload.rsvp_deadline = deadline ? new Date(deadline).toISOString() : null;
  for (const k of SETTINGS_BOOL) payload[k] = f[k].checked;
  if (payload.show_children_note && !payload.children_note_body) errors.push('نص ملاحظة الأطفال مطلوب عند إظهارها.');

  if (errors.length) {
    errBox.textContent = errors.join(' ');
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  btn.disabled = true;
  try {
    const { data } = await run(getSupabase().from('wedding_settings').update(payload).eq('id', 1).select('*'), 'تعذّر حفظ الإعدادات.');
    if (!data || data.length === 0) { toast('لم تُحفظ الإعدادات.', true); return; }
    state.settings = data[0];
    fillSettingsForm(state.settings);
    toast('تم حفظ الإعدادات. ستظهر في صفحة الدعوة فورًا.');
  } catch { /* handled */ } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------ السجل
async function loadAudit() {
  const { data } = await run(
    getSupabase().from('admin_audit_logs').select('id,admin_id,action,target_table,summary,changed_fields,created_at')
      .order('created_at', { ascending: false }).limit(100),
    'تعذّر تحميل السجل.',
  );
  const rows = data || [];
  $('audit-body').replaceChildren(...rows.map((r) => el('tr', {}, [
    el('td', { class: 'td-date', text: fmt(r.created_at) }),
    el('td', { text: ACTION_AR[r.action] || r.action }),
    el('td', { text: r.summary || '—' }),
    el('td', { class: 'td-fields', text: (r.changed_fields || []).join('، ') || '—', dir: 'ltr' }),
    el('td', { text: r.admin_id === state.user?.id ? 'أنت' : String(r.admin_id || '—').slice(0, 8) }),
  ])));
  $('audit-empty').hidden = rows.length > 0;
}
$('audit-refresh').addEventListener('click', () => loadAudit().catch(() => {}));

// ------------------------------------------------------------ التشغيل
async function init() {
  if (!isSupabaseConfigured()) { showView('view-config'); return; }
  try {
    getSupabase();
  } catch {
    showView('view-config');
    return;
  }
  onAuthChange((event, session) => {
    if (event === 'SIGNED_OUT' && state.user) showLogin('انتهت الجلسة أو تم تسجيل الخروج.');
    if (event === 'TOKEN_REFRESHED' && !session && state.user) showLogin('انتهت الجلسة. يرجى تسجيل الدخول مجددًا.');
  });
  // عند العودة للتبويب: تحقق أن الجلسة ما زالت صالحة.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !state.user) return;
    const session = await getCurrentSession();
    if (!session) showLogin('انتهت الجلسة. يرجى تسجيل الدخول مجددًا.');
  });

  const session = await getCurrentSession();
  if (session) await enterDashboard(session);
  else showLogin();
}

init();
