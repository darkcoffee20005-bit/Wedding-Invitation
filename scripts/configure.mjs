#!/usr/bin/env node
// ينسخ القيم العامة من .env إلى js/config.js (لأن الموقع ثابت ولا يقرأ .env).
//   node scripts/configure.mjs
// يرفض أي مفتاح سري (service_role أو sb_secret_) حتى لا يُنشر في المتصفح.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = `${root}.env`;
if (!existsSync(envPath)) {
  console.error('لا يوجد ملف .env — انسخ .env.example إلى .env واملأ القيم أولًا.');
  process.exit(1);
}

const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));

const url = env.PUBLIC_SUPABASE_URL || '';
const key = env.PUBLIC_SUPABASE_ANON_KEY || '';
const siteUrl = env.PUBLIC_SITE_URL || '';
const whatsapp = (env.PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');

function isSecretKey(k) {
  if (/^sb_secret_/i.test(k)) return true;
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload.role === 'service_role';
    } catch { return false; }
  }
  return false;
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && !/^https:\/\//.test(url)) {
  console.error('PUBLIC_SUPABASE_URL غير صالح (مثال: https://abcd.supabase.co)');
  process.exit(1);
}
if (!key || key === 'your-public-anon-key') {
  console.error('PUBLIC_SUPABASE_ANON_KEY فارغ.');
  process.exit(1);
}
if (isSecretKey(key)) {
  console.error('⛔ هذا مفتاح سري (service_role/secret). استخدم المفتاح العام anon/publishable فقط.');
  process.exit(1);
}

const configPath = `${root}js/config.js`;
let src = readFileSync(configPath, 'utf8');
const js = (v) => JSON.stringify(v).replace(/"/g, "'");
src = src.replace(/(\n\s*url:\s*)'[^']*'/, `$1${js(url.replace(/\/+$/, ''))}`);
src = src.replace(/(\n\s*anonKey:\s*)'[^']*'/, `$1${js(key)}`);
src = src.replace(/(\n\s*siteUrl:\s*)'[^']*'/, `$1${js(siteUrl)}`);
src = src.replace(/(\n\s*whatsappNumber:\s*)'[^']*'/, `$1${js(whatsapp)}`);
writeFileSync(configPath, src);
console.log('✓ تم تحديث js/config.js بالقيم العامة.');
