// نموذج تأكيد الحضور: التحقق، الإرسال، منع التكرار، التعديل، وحفظ المسودة.
import { RSVP_ERRORS } from './content.js';
import { fetchContext, submitRsvp, isRsvpConfigured, RsvpApiError } from './rsvp-api.js';
import { formatDateTimeAr } from './time-utils.js';

const EDIT_TOKEN_KEY = 'wedding_rsvp_edit_token';
const DRAFT_KEY = 'wedding_rsvp_draft';
const NAME_MIN = 2;
const NAME_MAX = 80;
const MESSAGE_MAX = 500;

// التخزين المحلي قد يكون غير متاح (تصفح خاص/حظر)، فكل وصول محمي.
const store = {
  get(area, key) { try { return window[area].getItem(key); } catch { return null; } },
  set(area, key, value) { try { window[area].setItem(key, value); } catch { /* ignore */ } },
  remove(area, key) { try { window[area].removeItem(key); } catch { /* ignore */ } },
};

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** رمز الدعوة من الرابط: #i=TOKEN (مفضل لأنه لا يُرسل للخوادم) أو ?i=TOKEN */
export function readInviteToken(location = window.location) {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('i');
  const fromQuery = new URLSearchParams(location.search).get('i');
  const token = (fromHash || fromQuery || '').trim();
  return token || null;
}

export function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** تحقق الواجهة (الخادم وقاعدة البيانات يعيدان التحقق). */
export function validateRsvpInput({ name, attendance, countRaw, message }, maxGuests) {
  const errors = {};
  const cleanName = normalizeName(name);
  const nameLength = [...cleanName].length;
  if (!cleanName) errors.name = 'يرجى كتابة الاسم.';
  else if (nameLength < NAME_MIN) errors.name = 'الاسم قصير جدًا.';
  else if (nameLength > NAME_MAX) errors.name = `الاسم أطول من ${NAME_MAX} حرفًا.`;

  if (attendance !== 'attending' && attendance !== 'declined') errors.attendance = 'يرجى اختيار أحد الخيارين.';

  let count = 0;
  if (attendance === 'attending') {
    const raw = String(countRaw ?? '').trim();
    if (!/^\d+$/.test(raw)) errors.count = 'يرجى إدخال عدد صحيح (بدون كسور أو رموز).';
    else {
      count = Number(raw);
      if (count < 1) errors.count = 'العدد يجب أن يكون شخصًا بالغًا واحدًا على الأقل.';
      else if (count > maxGuests) errors.count = `الحد الأقصى لهذا الرد هو ${maxGuests} من البالغين.`;
    }
  }

  const cleanMessage = String(message || '').trim();
  if ([...cleanMessage].length > MESSAGE_MAX) errors.message = `الرسالة أطول من ${MESSAGE_MAX} حرف.`;

  return { errors, value: { guest_name: cleanName, attendance, guest_count: attendance === 'attending' ? count : 0, message: cleanMessage } };
}

export function createRsvpController() {
  const $ = (id) => document.getElementById(id);
  const form = $('rsvp-form');
  const nameInput = $('guest-name');
  const countField = $('guest-count-field');
  const countInput = $('guest-count');
  const messageInput = $('guest-message');
  const messageCount = $('message-count');
  const submitBtn = $('rsvp-submit');
  const submitLabel = submitBtn.querySelector('.btn__label');
  const alertBox = $('rsvp-alert');
  const banner = $('rsvp-banner');
  const success = $('rsvp-success');
  const honeypot = form.querySelector('input[name="website"]');

  const state = {
    mode: 'open',            // open | invitation | edit | closed | unavailable
    inviteToken: readInviteToken(),
    editToken: store.get('localStorage', EDIT_TOKEN_KEY),
    maxGuests: 5,
    requestId: uuid(),       // ثابت حتى ينجح الإرسال → إعادة المحاولة لا تكرر الرد
    submitting: false,
    contextLoaded: false,
  };

  const attendanceValue = () => form.querySelector('input[name="attendance"]:checked')?.value || null;

  // ------------------------------------------------------------ عرض الرسائل
  function setBanner(html, variant = '') {
    if (!html) { banner.hidden = true; banner.textContent = ''; return; }
    banner.className = `banner${variant ? ` banner--${variant}` : ''}`;
    banner.replaceChildren(...html);
    banner.hidden = false;
  }

  function text(t, strong = false) {
    const node = strong ? document.createElement('strong') : document.createTextNode(t);
    if (strong) node.textContent = t;
    return node;
  }

  function showFieldError(fieldId, inputEl, message) {
    const el = $(fieldId);
    if (message) {
      el.textContent = message;
      el.hidden = false;
      inputEl.setAttribute('aria-invalid', 'true');
    } else {
      el.textContent = '';
      el.hidden = true;
      inputEl.removeAttribute('aria-invalid');
    }
  }

  function showAlert(message) {
    alertBox.textContent = message || '';
    alertBox.hidden = !message;
  }

  function setLoading(loading) {
    state.submitting = loading;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('is-loading', loading);
    submitBtn.setAttribute('aria-busy', String(loading));
    form.setAttribute('aria-busy', String(loading));
    submitLabel.textContent = loading ? 'جارٍ الإرسال…' : 'إرسال تأكيد الحضور';
  }

  // ------------------------------------------------------------ الحقول
  function updateCountVisibility() {
    const attending = attendanceValue() === 'attending';
    countField.hidden = !attending;
    if (!attending) showFieldError('guest-count-error', countInput, '');
  }

  function setMaxGuests(max) {
    state.maxGuests = Math.max(1, Number(max) || 1);
    countInput.max = String(state.maxGuests);
    document.querySelectorAll('[data-bind="max_guests"]').forEach((el) => { el.textContent = String(state.maxGuests); });
    updateStepper();
  }

  function updateStepper() {
    const n = Number(countInput.value);
    form.querySelector('[data-step="-1"]').disabled = !(n > 1);
    form.querySelector('[data-step="1"]').disabled = !(n < state.maxGuests);
  }

  function updateCounter() {
    messageCount.textContent = String([...messageInput.value].length);
  }

  function fillForm(values) {
    if (values.guest_name != null) nameInput.value = values.guest_name;
    if (values.attendance) {
      const radio = form.querySelector(`input[name="attendance"][value="${values.attendance}"]`);
      if (radio) radio.checked = true;
    }
    if (values.attendance === 'attending' && values.guest_count) countInput.value = String(values.guest_count);
    if (values.message != null) messageInput.value = values.message;
    updateCountVisibility();
    updateCounter();
    updateStepper();
  }

  function saveDraft() {
    store.set('sessionStorage', DRAFT_KEY, JSON.stringify({
      guest_name: nameInput.value,
      attendance: attendanceValue(),
      guest_count: countInput.value,
      message: messageInput.value,
    }));
  }

  function restoreDraft() {
    const raw = store.get('sessionStorage', DRAFT_KEY);
    if (!raw) return false;
    try {
      const d = JSON.parse(raw);
      fillForm(d);
      return true;
    } catch { return false; }
  }

  // ------------------------------------------------------------ الحالة العامة
  function disableForm(reasonNodes, variant) {
    setBanner(reasonNodes, variant);
    form.hidden = true;
  }

  function enableForm() {
    form.hidden = false;
    submitBtn.disabled = false;
  }

  function applyContext(ctx) {
    const settings = ctx.settings;
    state.contextLoaded = true;
    setMaxGuests(settings.max_guests_per_response);

    if (!settings.rsvp_open) {
      state.mode = 'closed';
      disableForm([text(RSVP_ERRORS.closed)], 'warning');
      return;
    }

    if (state.inviteToken) {
      if (ctx.invitation && ctx.invitation.status === 'valid') {
        state.mode = 'invitation';
        setMaxGuests(ctx.invitation.max_guests);
        const nodes = [text('دعوة خاصة لـ: '), text(ctx.invitation.guest_label, true)];
        if (ctx.response) {
          nodes.push(text(` — سبق أن سجّلتم ردكم بتاريخ ${formatDateTimeAr(ctx.response.updated_at)}. يمكنكم تعديله أدناه.`));
          fillForm(ctx.response);
        } else if (!nameInput.value) {
          nameInput.value = ctx.invitation.guest_label.slice(0, NAME_MAX);
        }
        setBanner(nodes);
        enableForm();
        return;
      }
      // رابط غير صالح
      state.inviteToken = null;
      if (settings.allow_open_rsvp) {
        state.mode = 'open';
        setBanner([text(RSVP_ERRORS.invalid_invitation), text(' يمكنكم مع ذلك تأكيد الحضور عبر النموذج العام أدناه.')], 'warning');
        enableForm();
      } else {
        state.mode = 'closed';
        disableForm([text(RSVP_ERRORS.invalid_invitation)], 'error');
      }
      return;
    }

    if (state.editToken && ctx.edit_token === 'valid' && ctx.response) {
      state.mode = 'edit';
      fillForm(ctx.response);
      setBanner([text(`سبق أن سجّلتم ردكم من هذا الجهاز بتاريخ ${formatDateTimeAr(ctx.response.updated_at)}. يمكنكم تعديله أدناه بدل إرسال رد جديد.`)]);
      enableForm();
      return;
    }
    if (state.editToken && ctx.edit_token === 'invalid') {
      store.remove('localStorage', EDIT_TOKEN_KEY);
      state.editToken = null;
    }

    if (!settings.allow_open_rsvp) {
      state.mode = 'closed';
      disableForm([text(RSVP_ERRORS.invitation_required)], 'warning');
      return;
    }
    state.mode = 'open';
    setBanner(null);
    enableForm();
  }

  async function loadContext() {
    if (!isRsvpConfigured()) {
      state.mode = 'unavailable';
      setBanner([text(RSVP_ERRORS.not_configured)], 'warning');
      submitBtn.disabled = true;
      return null;
    }
    try {
      const ctx = await fetchContext({ inviteToken: state.inviteToken, editToken: state.inviteToken ? null : state.editToken });
      applyContext(ctx);
      return ctx;
    } catch (err) {
      const code = err instanceof RsvpApiError ? err.code : 'network';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn--ghost';
      retry.style.marginTop = '10px';
      retry.textContent = 'إعادة المحاولة';
      retry.addEventListener('click', () => { setBanner([text('جارٍ إعادة الاتصال…')]); loadContext(); });
      setBanner([text(RSVP_ERRORS[code] || RSVP_ERRORS.server_error), document.createElement('br'), retry], 'warning');
      return null;
    }
  }

  // ------------------------------------------------------------ الإرسال
  function showSuccess(data) {
    const r = data.response;
    const attending = r.attendance === 'attending';
    $('rsvp-success-title').textContent = data.mode === 'updated' ? 'تم تحديث ردكم بنجاح' : 'تم استلام ردكم بنجاح';
    $('rsvp-success-text').textContent = attending
      ? 'يسعدنا تأكيد حضوركم، وبانتظاركم بكل حب.'
      : 'نشكركم على إبلاغنا، وسنفتقد وجودكم بيننا. دعواتكم تكفينا.';

    const rows = [['الاسم', r.guest_name], ['الحضور', attending ? 'سأحضر' : 'أعتذر عن الحضور']];
    if (attending) rows.push(['عدد البالغين', String(r.guest_count)]);
    if (r.message) rows.push(['رسالتكم', r.message]);
    const summary = $('rsvp-summary');
    summary.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      return [dt, dd];
    }));

    form.hidden = true;
    banner.hidden = true;
    success.hidden = false;
    success.focus();
    document.dispatchEvent(new CustomEvent('rsvp:success', { detail: { attendance: r.attendance, mode: data.mode } }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (state.submitting) return; // منع الضغط المزدوج
    showAlert('');

    const { errors, value } = validateRsvpInput({
      name: nameInput.value,
      attendance: attendanceValue(),
      countRaw: countInput.value,
      message: messageInput.value,
    }, state.maxGuests);

    showFieldError('guest-name-error', nameInput, errors.name);
    const fieldset = form.querySelector('fieldset');
    showFieldError('attendance-error', fieldset, errors.attendance);
    showFieldError('guest-count-error', countInput, errors.count);
    showFieldError('guest-message-error', messageInput, errors.message);

    const firstInvalid = errors.name ? nameInput
      : errors.attendance ? form.querySelector('input[name="attendance"]')
      : errors.count ? countInput
      : errors.message ? messageInput : null;
    if (firstInvalid) { firstInvalid.focus(); return; }

    if (!isRsvpConfigured()) { showAlert(RSVP_ERRORS.not_configured); return; }

    const payload = { ...value, website: honeypot.value };
    if (state.mode === 'invitation' && state.inviteToken) payload.invite_token = state.inviteToken;
    else if (state.mode === 'edit' && state.editToken) payload.edit_token = state.editToken;
    else payload.request_id = state.requestId;

    setLoading(true);
    try {
      const data = await submitRsvp(payload);
      // النجاح يُعرض فقط بعد تأكيد الخادم أن الحفظ تم.
      if (data.edit_token) {
        store.set('localStorage', EDIT_TOKEN_KEY, data.edit_token);
        state.editToken = data.edit_token;
        state.mode = 'edit';
      }
      state.requestId = uuid();
      store.remove('sessionStorage', DRAFT_KEY);
      showSuccess(data);
    } catch (err) {
      const code = err instanceof RsvpApiError ? err.code : 'server_error';
      if (code === 'invalid_edit_token') {
        store.remove('localStorage', EDIT_TOKEN_KEY);
        state.editToken = null;
        state.mode = 'open';
      }
      if (code === 'guest_count_exceeds_limit') {
        showFieldError('guest-count-error', countInput, RSVP_ERRORS.guest_count_exceeds_limit);
      }
      showAlert(RSVP_ERRORS[code] || RSVP_ERRORS.server_error);
      alertBox.focus?.();
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------------------------ الأحداث
  form.addEventListener('submit', onSubmit);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'attendance') {
      updateCountVisibility();
      showFieldError('attendance-error', form.querySelector('fieldset'), '');
    }
    saveDraft();
  });
  form.addEventListener('input', (e) => {
    if (e.target === messageInput) updateCounter();
    if (e.target === countInput) updateStepper();
    if (e.target.getAttribute('aria-invalid') === 'true') e.target.removeAttribute('aria-invalid');
    saveDraft();
  });
  form.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = /^\d+$/.test(countInput.value) ? Number(countInput.value) : 1;
      const next = Math.min(state.maxGuests, Math.max(1, current + Number(btn.dataset.step)));
      countInput.value = String(next);
      updateStepper();
      saveDraft();
    });
  });
  $('rsvp-edit-btn').addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    nameInput.focus();
  });
  alertBox.tabIndex = -1;

  restoreDraft();
  updateCountVisibility();
  updateCounter();
  updateStepper();

  return { loadContext, state };
}
