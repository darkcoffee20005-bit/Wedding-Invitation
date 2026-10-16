// Supabase Edge Function: rsvp
// تُنشر بالأمر: supabase functions deploy rsvp --no-verify-jwt
// (لا تتطلب JWT لأنها عامة للمدعوين؛ الحماية عبر التحقق وتحديد المعدل ودوال قاعدة البيانات المقيدة.)
//
// متغيرات البيئة:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  ← يوفرها Supabase تلقائيًا داخل Edge Functions.
//   RSVP_IP_SALT       ← سر عشوائي طويل (supabase secrets set RSVP_IP_SALT=...).
//   ALLOWED_ORIGINS    ← نطاقات الموقع مفصولة بفواصل، مثل https://example.com,https://www.example.com
//   RSVP_SUBMIT_LIMIT  ← اختياري، الافتراضي 10 إرسالات لكل 10 دقائق لكل IP.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ipSalt = Deno.env.get("RSVP_IP_SALT") ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}
if (ipSalt.length < 16) {
  console.warn("RSVP_IP_SALT is missing or short; set a long random secret.");
}

// مفتاح service_role يبقى داخل الخادم فقط ولا يصل للمتصفح أبدًا.
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const handler = createHandler({
  rpc: async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: error ? { message: error.message, code: error.code } : null };
  },
  ipSalt,
  allowedOrigins,
  submitLimit: Number(Deno.env.get("RSVP_SUBMIT_LIMIT") ?? 10) || 10,
});

Deno.serve(handler);
