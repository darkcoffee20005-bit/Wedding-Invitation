// الاتصال بالـ Edge Function الخاصة بتأكيد الحضور.
import { getSupabaseConfig, getUiConfig } from './config.js';

export class RsvpApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isRsvpConfigured() {
  return Boolean(getSupabaseConfig().rsvpFunctionUrl);
}

async function call(payload) {
  const { rsvpFunctionUrl, anonKey } = getSupabaseConfig();
  if (!rsvpFunctionUrl) throw new RsvpApiError('not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getUiConfig().requestTimeoutMs);
  let res;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (anonKey) {
      headers.apikey = anonKey; // مفتاح عام فقط
      // المفتاح العام بصيغة JWT يمرّ من بوابة Supabase حتى لو بقي خيار "Verify JWT" مفعّلًا في الدالة
      if (anonKey.split('.').length === 3) headers.Authorization = `Bearer ${anonKey}`;
    }
    res = await fetch(rsvpFunctionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    throw new RsvpApiError(err && err.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new RsvpApiError(res.status === 429 ? 'rate_limited' : 'server_error', res.status);
  }
  if (!res.ok || !data || data.ok !== true) {
    throw new RsvpApiError((data && typeof data.error === 'string' && data.error) || 'server_error', res.status);
  }
  return data;
}

export function fetchContext({ inviteToken, editToken }) {
  return call({ action: 'context', invite_token: inviteToken || undefined, edit_token: editToken || undefined });
}

export function submitRsvp(payload) {
  return call({ action: 'submit', ...payload });
}
