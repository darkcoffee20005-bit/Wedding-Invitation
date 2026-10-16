// عميل Supabase للوحة الإدارة فقط (صفحة الدعوة العامة لا تحتاجه).
// يستخدم المفتاح العام anon؛ الصلاحيات الفعلية تفرضها RLS ودوال is_admin() في القاعدة.
// المكتبة مضمّنة محليًا (js/vendor/supabase.js — @supabase/supabase-js 2.45.4) لتجنب الاعتماد على CDN.
import { getSupabaseConfig } from './config.js';

let client = null;

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export function getSupabase() {
  if (client) return client;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;
  if (!globalThis.supabase || typeof globalThis.supabase.createClient !== 'function') {
    throw new Error('supabase-js library failed to load');
  }
  client = globalThis.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'wedding-admin-auth',
    },
  });
  return client;
}

/** هل الخطأ ناتج عن جلسة منتهية أو غير صالحة؟ */
export function isAuthError(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode;
  const msg = String(error.message || '').toLowerCase();
  return status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303'
    || msg.includes('jwt expired') || msg.includes('invalid jwt') || msg.includes('not authenticated');
}

/** هل الخطأ رفض صلاحيات؟ */
export function isForbiddenError(error) {
  if (!error) return false;
  return error.code === '42501' || String(error.message || '').includes('forbidden') || error.status === 403;
}
