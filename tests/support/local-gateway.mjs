// للاختبار المحلي فقط — بوابة تحاكي واجهة Supabase على منفذ واحد:
//   /rest/v1/*        → PostgREST الحقيقي (RLS والصلاحيات الحقيقية من ملفات SQL)
//   /functions/v1/rsvp → الـ Edge Function الحقيقية (handler.ts) عبر Deno
//   /auth/v1/*        → محاكاة مبسطة لـ Supabase Auth (تسجيل دخول بكلمة مرور، تجديد، خروج)
// محاكاة Auth هي الجزء الوحيد غير الحقيقي؛ تُصدر JWT موقعًا بنفس سر PostgREST.
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { signJwt, verifyJwt, TEST_USERS } from './jwt.mjs';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const REST = { host: '127.0.0.1', port: Number(process.env.POSTGREST_PORT || 54331) };
const EDGE = { host: '127.0.0.1', port: Number(process.env.EDGE_PORT || 54330) };
const TOKEN_TTL = Number(process.env.TOKEN_TTL || 3600);

const refreshTokens = new Map(); // refresh → email
const issuedSessions = new Set();  // معرفات الجلسات الصادرة
const revokedSessions = new Set(); // جلسات أُبطلت لمحاكاة انتهاء الجلسة

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range, content-profile',
};

function send(res, status, body) {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function issueSession(email) {
  const user = TEST_USERS[email];
  const now = Math.floor(Date.now() / 1000);
  const sid = randomBytes(8).toString('hex');
  issuedSessions.add(sid);
  const access = signJwt({ sub: user.id, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + TOKEN_TTL, session_id: sid });
  const refresh = randomBytes(16).toString('hex');
  refreshTokens.set(refresh, email);
  return {
    access_token: access, token_type: 'bearer', expires_in: TOKEN_TTL, expires_at: now + TOKEN_TTL, refresh_token: refresh,
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function tokenRevoked(token) {
  const p = verifyJwt(token);
  return Boolean(p && p.role === 'authenticated' && revokedSessions.has(p.session_id));
}

function proxy(req, res, target, path, body) {
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  delete headers['content-length'];
  if (body.length) headers['content-length'] = String(body.length);
  const up = httpRequest({ ...target, path, method: req.method, headers }, (upRes) => {
    const h = { ...upRes.headers };
    for (const k of Object.keys(h)) if (k.startsWith('access-control-')) delete h[k];
    Object.assign(h, cors);
    res.writeHead(upRes.statusCode, h);
    upRes.pipe(res);
  });
  up.on('error', () => send(res, 502, { message: 'upstream unavailable' }));
  up.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const body = await readBody(req);

  // تحكم الاختبارات
  if (url.pathname === '/__test/expire-sessions') { issuedSessions.forEach((sid) => revokedSessions.add(sid)); refreshTokens.clear(); send(res, 200, { ok: true }); return; }

  if (url.pathname.startsWith('/auth/v1/')) {
    const route = url.pathname.slice('/auth/v1'.length);
    if (route === '/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = JSON.parse(body.toString() || '{}');
      const u = TEST_USERS[String(email || '').toLowerCase()];
      if (!u || u.password !== password) { send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }); return; }
      send(res, 200, issueSession(String(email).toLowerCase()));
      return;
    }
    if (route === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const { refresh_token } = JSON.parse(body.toString() || '{}');
      const email = refreshTokens.get(refresh_token);
      if (!email) { send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); return; }
      refreshTokens.delete(refresh_token);
      send(res, 200, issueSession(email));
      return;
    }
    if (route === '/logout') { res.writeHead(204, cors); res.end(); return; }
    if (route === '/user') {
      const p = verifyJwt(bearer(req));
      if (!p || p.role !== 'authenticated' || tokenRevoked(bearer(req))) { send(res, 401, { code: 401, msg: 'invalid JWT' }); return; }
      send(res, 200, { id: p.sub, email: p.email, aud: 'authenticated', role: 'authenticated' });
      return;
    }
    send(res, 404, { msg: 'not implemented in local auth emulator' });
    return;
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const token = bearer(req);
    if (token && tokenRevoked(token)) { send(res, 401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null }); return; }
    proxy(req, res, REST, url.pathname.slice('/rest/v1'.length) + url.search, body);
    return;
  }

  if (url.pathname === '/functions/v1/rsvp') {
    proxy(req, res, EDGE, '/', body);
    return;
  }
  send(res, 404, { message: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`local gateway on ${PORT}`));
