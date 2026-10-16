// للاختبار المحلي فقط: توقيع JWT (HS256) متوافق مع PostgREST.
import { createHmac } from 'node:crypto';

export const TEST_JWT_SECRET = 'local-test-jwt-secret-at-least-32-characters-long';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(payload, secret = TEST_JWT_SECRET) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret = TEST_JWT_SECRET) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// مفتاح "anon" ثابت للاختبارات (مثل المفتاح العام في Supabase).
export const TEST_ANON_KEY = signJwt({ role: 'anon', iss: 'local-test' });

export const TEST_USERS = {
  'admin@test.local': { id: '11111111-1111-1111-1111-111111111111', password: 'Admin-Test-Pass-1' },
  'user@test.local': { id: '22222222-2222-2222-2222-222222222222', password: 'User-Test-Pass-1' },
};
