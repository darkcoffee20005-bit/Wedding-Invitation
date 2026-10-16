// تسجيل دخول المدير والتحقق من صلاحيته.
// ملاحظة: إخفاء الواجهة ليس وسيلة الحماية؛ القاعدة ترفض أي عملية لمن ليس في admin_users.
import { getSupabase } from './supabase-client.js';

export async function getCurrentSession() {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) return null;
  return data.session || null;
}

/** يتحقق من الخادم (وليس من الواجهة) أن المستخدم مدير. */
export async function checkIsAdmin() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('is_admin');
  if (error) throw error;
  return data === true;
}

export async function signIn(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    const status = error.status;
    if (status === 400 || status === 401) throw new Error('بيانات الدخول غير صحيحة.');
    if (status === 429) throw new Error('محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.');
    throw new Error('تعذّر تسجيل الدخول. تحقّق من الاتصال وحاول مرة أخرى.');
  }
  return data.session;
}

export async function signOut() {
  const sb = getSupabase();
  try {
    await sb.auth.signOut({ scope: 'local' });
  } catch {
    /* حتى لو فشل الطلب تُمسح الجلسة المحلية */
  }
}

export function onAuthChange(callback) {
  const sb = getSupabase();
  const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}
