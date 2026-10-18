// =============================================================================
// دالة تأكيد الحضور rsvp — نسخة الملف الواحد (مولّدة تلقائيًا، لا تعدّلها يدويًا).
// الصقها كاملة في Supabase: Edge Functions → Deploy a new function → Via Editor
// واجعل اسم الدالة: rsvp
// الأسرار الاختيارية (Edge Functions → Secrets): RSVP_IP_SALT, ALLOWED_ORIGINS, RSVP_SUBMIT_LIMIT
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// منطق الـ Edge Function الخاصة بتأكيد الحضور (مفصول عن Deno.serve لتسهيل الاختبار).
//
// المسار: POST /functions/v1/rsvp
//   { "action": "context", "invite_token"?: string, "edit_token"?: string }
//   { "action": "submit",  "invite_token"?: string, "edit_token"?: string, "request_id": uuid,
//     "guest_name": string, "attendance": "attending"|"declined", "guest_count": int,
//     "message"?: string, "website"?: "" (حقل فخ للروبوتات يجب أن يبقى فارغًا) }
//
// الاستجابة دائمًا JSON: { ok: true, ... } أو { ok: false, error: "<code>" } بدون تفاصيل داخلية.

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

interface RsvpDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** ملح سري لتجزئة عنوان IP قبل إرساله لقاعدة البيانات. */
  ipSalt: string;
  /** النطاقات المسموح لها باستدعاء الدالة. ['*'] = الجميع. */
  allowedOrigins: string[];
  submitLimit?: number;
  contextLimit?: number;
  windowSeconds?: number;
  logError?: (...args: unknown[]) => void;
}

const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  messageMax: 500,
  bodyMaxBytes: 8_000,
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// رموز الأخطاء القادمة من قاعدة البيانات (raise exception 'rsvp:<code>') → حالة HTTP.
const DB_ERRORS: Record<string, number> = {
  invalid_name: 422,
  invalid_attendance: 422,
  invalid_guest_count: 422,
  guest_count_exceeds_limit: 422,
  invalid_message: 422,
  invalid_request: 400,
  invalid_invitation: 403,
  invalid_edit_token: 403,
  invitation_required: 403,
  closed: 403,
  settings_missing: 503,
};

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

function normalizeSingleLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeMultiline(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalToken(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !TOKEN_RE.test(value)) throw new HttpError(400, "invalid_token_format");
  return value;
}

interface SubmitInput {
  invite_token: string | null;
  edit_token: string | null;
  request_id: string | null;
  guest_name: string;
  attendance: "attending" | "declined";
  guest_count: number;
  message: string | null;
}

/** تحقق الخادم من المدخلات (قاعدة البيانات تعيد التحقق أيضًا). */
function validateSubmit(body: Record<string, unknown>): SubmitInput {
  if (typeof body.website === "string" && body.website.trim() !== "") {
    throw new HttpError(400, "invalid_request"); // حقل الفخ ممتلئ → روبوت
  }

  const invite_token = optionalToken(body.invite_token);
  const edit_token = invite_token ? null : optionalToken(body.edit_token);

  let request_id: string | null = null;
  if (body.request_id !== undefined && body.request_id !== null) {
    if (typeof body.request_id !== "string" || !UUID_RE.test(body.request_id)) {
      throw new HttpError(400, "invalid_request");
    }
    request_id = body.request_id.toLowerCase();
  }
  if (!invite_token && !edit_token && !request_id) throw new HttpError(400, "invalid_request");

  const guest_name = normalizeSingleLine(body.guest_name);
  const nameLength = [...guest_name].length;
  if (nameLength < LIMITS.nameMin || nameLength > LIMITS.nameMax) throw new HttpError(422, "invalid_name");

  const attendance = body.attendance;
  if (attendance !== "attending" && attendance !== "declined") throw new HttpError(422, "invalid_attendance");

  let guest_count = 0;
  if (attendance === "attending") {
    const raw = body.guest_count;
    // يُرفض: الكسور، النصوص غير الرقمية، الصفر، السالب.
    const n = typeof raw === "number" ? raw : (typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new HttpError(422, "invalid_guest_count");
    guest_count = n;
  }

  const messageRaw = body.message;
  if (messageRaw !== undefined && messageRaw !== null && typeof messageRaw !== "string") {
    throw new HttpError(422, "invalid_message");
  }
  const message = normalizeMultiline(messageRaw);
  if ([...message].length > LIMITS.messageMax) throw new HttpError(422, "invalid_message");

  return {
    invite_token,
    edit_token,
    request_id,
    guest_name,
    attendance,
    guest_count,
    message: message === "" ? null : message,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowed.includes("*")) headers["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  // الطلبات بدون Origin (مثل curl) لا تخضع لـ CORS؛ تحديد المعدل والتحقق يبقيان ساريين.
  if (!origin) return true;
  return allowed.includes(origin);
}

function dbErrorCode(error: { message: string }): string | null {
  const match = /rsvp:([a-z_]+)/.exec(error.message ?? "");
  return match && match[1] in DB_ERRORS ? match[1] : null;
}

function createHandler(deps: RsvpDeps) {
  const submitLimit = deps.submitLimit ?? 10;
  const contextLimit = deps.contextLimit ?? 60;
  const windowSeconds = deps.windowSeconds ?? 600;
  const logError = deps.logError ?? ((...a: unknown[]) => console.error(...a));

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin, deps.allowedOrigins);
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
      if (!originAllowed(origin, deps.allowedOrigins)) throw new HttpError(403, "origin_not_allowed");

      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > LIMITS.bodyMaxBytes) throw new HttpError(413, "payload_too_large");

      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        body = parsed;
      } catch {
        throw new HttpError(400, "invalid_json");
      }

      const action = body.action;
      if (action !== "context" && action !== "submit") throw new HttpError(400, "invalid_action");

      const clientKey = await sha256Hex(`${deps.ipSalt}|${clientIp(req)}`);
      const limited = await deps.rpc("rsvp_consume_rate_limit", {
        p_client_key: `${action}:${clientKey}`,
        p_limit: action === "submit" ? submitLimit : contextLimit,
        p_window_seconds: windowSeconds,
      });
      if (limited.error) {
        logError("rate limit rpc failed", limited.error.message);
        throw new HttpError(500, "server_error");
      }
      if (limited.data !== true) throw new HttpError(429, "rate_limited");

      if (action === "context") {
        // الرموز المشوّهة تُمرَّر كما هي لتعيد القاعدة حالة "invalid" بدل خطأ.
        const lenient = (v: unknown) => (typeof v === "string" && v !== "" && v.length <= 64 ? v : null);
        const { data, error } = await deps.rpc("rsvp_get_context", {
          p_invite_token: lenient(body.invite_token),
          p_edit_token: lenient(body.invite_token) ? null : lenient(body.edit_token),
        });
        if (error) {
          const code = dbErrorCode(error);
          if (code) throw new HttpError(DB_ERRORS[code], code);
          logError("context rpc failed", error.message);
          throw new HttpError(500, "server_error");
        }
        return json(200, { ok: true, ...(data as Record<string, unknown>) });
      }

      const input = validateSubmit(body);
      const { data, error } = await deps.rpc("rsvp_submit", {
        p_invite_token: input.invite_token,
        p_edit_token: input.edit_token,
        p_request_id: input.invite_token || input.edit_token ? null : input.request_id,
        p_guest_name: input.guest_name,
        p_attendance: input.attendance,
        p_guest_count: input.guest_count,
        p_message: input.message,
      });
      if (error) {
        const code = dbErrorCode(error);
        if (code) throw new HttpError(DB_ERRORS[code], code);
        logError("submit rpc failed", error.message);
        throw new HttpError(500, "server_error");
      }
      return json(200, { ok: true, ...(data as Record<string, unknown>) });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { ok: false, error: err.code });
      logError("unexpected error", err);
      return json(500, { ok: false, error: "server_error" });
    }
  };
}


const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ipSalt = Deno.env.get("RSVP_IP_SALT") ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}
if (ipSalt.length < 16) {
  console.warn("RSVP_IP_SALT is missing or short; set a long random secret.");
}

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
