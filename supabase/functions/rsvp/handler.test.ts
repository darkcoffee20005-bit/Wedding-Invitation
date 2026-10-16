// اختبارات منطق الـ Edge Function.
//   deno test -A supabase/functions/rsvp/handler.test.ts
// اختبارات التكامل مع قاعدة بيانات حقيقية تعمل فقط عند ضبط TEST_DATABASE_URL.
import { assertEquals, assert } from "jsr:@std/assert@1.0.8";
import { createHandler, validateSubmit, HttpError, type RpcResult } from "./handler.ts";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDeps(overrides: Partial<Record<string, RpcResult>> = {}, allowedOrigins = ["*"]) {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      rpc: async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
        calls.push({ fn, args });
        if (overrides[fn]) return overrides[fn]!;
        if (fn === "rsvp_consume_rate_limit") return { data: true, error: null };
        return { data: { mode: "created", response: { guest_name: "x" } }, error: null };
      },
      ipSalt: "test-salt-0123456789",
      allowedOrigins,
      logError: () => {},
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/rsvp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validOpen = {
  action: "submit",
  request_id: "6f1c2b8e-4c7a-4d2b-9a1e-1234567890ab",
  guest_name: "  أحمد   علي ",
  attendance: "attending",
  guest_count: 2,
  message: " مبروك ",
};

Deno.test("validateSubmit: normalizes and accepts valid attending", () => {
  const v = validateSubmit(validOpen);
  assertEquals(v.guest_name, "أحمد علي");
  assertEquals(v.guest_count, 2);
  assertEquals(v.message, "مبروك");
});

Deno.test("validateSubmit: decline forces guest_count 0", () => {
  const v = validateSubmit({ ...validOpen, attendance: "declined", guest_count: 7 });
  assertEquals(v.guest_count, 0);
});

for (const [label, patch, code] of [
  ["empty name", { guest_name: "   " }, "invalid_name"],
  ["1-char name", { guest_name: "ا" }, "invalid_name"],
  ["long name", { guest_name: "ب".repeat(81) }, "invalid_name"],
  ["missing attendance", { attendance: undefined }, "invalid_attendance"],
  ["unknown attendance", { attendance: "maybe" }, "invalid_attendance"],
  ["zero count", { guest_count: 0 }, "invalid_guest_count"],
  ["negative count", { guest_count: -3 }, "invalid_guest_count"],
  ["fraction count", { guest_count: 1.5 }, "invalid_guest_count"],
  ["non-numeric count", { guest_count: "abc" }, "invalid_guest_count"],
  ["numeric-string fraction", { guest_count: "2.5" }, "invalid_guest_count"],
  ["long message", { message: "x".repeat(501) }, "invalid_message"],
  ["non-string message", { message: 42 }, "invalid_message"],
  ["honeypot filled", { website: "http://spam" }, "invalid_request"],
  ["bad request id", { request_id: "123" }, "invalid_request"],
  ["bad invite token", { invite_token: "short" }, "invalid_token_format"],
] as const) {
  Deno.test(`validateSubmit rejects: ${label}`, () => {
    try {
      validateSubmit({ ...validOpen, ...patch });
      throw new Error("expected rejection");
    } catch (e) {
      assert(e instanceof HttpError, String(e));
      assertEquals(e.code, code);
    }
  });
}

Deno.test("handler: OPTIONS preflight returns CORS headers", async () => {
  const { deps } = fakeDeps({}, ["https://wedding.example"]);
  const res = await createHandler(deps)(new Request("http://x", { method: "OPTIONS", headers: { origin: "https://wedding.example" } }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "https://wedding.example");
});

Deno.test("handler: disallowed origin rejected", async () => {
  const { deps, calls } = fakeDeps({}, ["https://wedding.example"]);
  const res = await createHandler(deps)(post(validOpen, { origin: "https://evil.example" }));
  assertEquals(res.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("handler: GET not allowed", async () => {
  const { deps } = fakeDeps();
  const res = await createHandler(deps)(new Request("http://x"));
  assertEquals(res.status, 405);
});

Deno.test("handler: invalid JSON → 400, oversize → 413", async () => {
  const { deps } = fakeDeps();
  const h = createHandler(deps);
  assertEquals((await h(post("{not json"))).status, 400);
  assertEquals((await h(post({ action: "submit", message: "x".repeat(9000) }))).status, 413);
});

Deno.test("handler: rate limited → 429 and submit RPC not called", async () => {
  const { deps, calls } = fakeDeps({ rsvp_consume_rate_limit: { data: false, error: null } });
  const res = await createHandler(deps)(post(validOpen));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "rate_limited");
  assert(!calls.some((c) => c.fn === "rsvp_submit"));
});

Deno.test("handler: IP is hashed with salt before reaching DB", async () => {
  const { deps, calls } = fakeDeps();
  await createHandler(deps)(post(validOpen));
  const key = String(calls[0].args.p_client_key);
  assert(key.startsWith("submit:"));
  assert(!key.includes("203.0.113.7"));
  assertEquals(key.length, "submit:".length + 64);
});

Deno.test("handler: DB error codes mapped, internals hidden", async () => {
  const { deps } = fakeDeps({ rsvp_submit: { data: null, error: { message: "rsvp:guest_count_exceeds_limit" } } });
  const res = await createHandler(deps)(post(validOpen));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { ok: false, error: "guest_count_exceeds_limit" });

  const { deps: d2 } = fakeDeps({ rsvp_submit: { data: null, error: { message: 'relation "secret_table" does not exist' } } });
  const res2 = await createHandler(d2)(post(validOpen));
  assertEquals(res2.status, 500);
  const text = await res2.text();
  assert(!text.includes("secret_table"));
  assertEquals(JSON.parse(text).error, "server_error");
});

Deno.test("handler: decline sends 0 to DB", async () => {
  const { deps, calls } = fakeDeps();
  await createHandler(deps)(post({ ...validOpen, attendance: "declined", guest_count: 3 }));
  const submit = calls.find((c) => c.fn === "rsvp_submit")!;
  assertEquals(submit.args.p_guest_count, 0);
});

// ---------------- تكامل مع PostgreSQL حقيقي ----------------
const dbUrl = Deno.env.get("TEST_DATABASE_URL");
Deno.test({
  name: "integration: real DB — submit, retry idempotency, edit, limits, context privacy",
  ignore: !dbUrl,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { createPgRpc } = await import("../../../tests/support/pg-rpc.ts");
    const db = createPgRpc(dbUrl!);
    try {
      const h = createHandler({ rpc: db.rpc, ipSalt: "integration-salt-123456", allowedOrigins: ["*"], submitLimit: 1000, contextLimit: 1000, logError: () => {} });
      const requestId = crypto.randomUUID();
      const body = { ...validOpen, request_id: requestId, guest_name: "اختبار تكامل" };

      const r1 = await (await h(post(body))).json();
      assertEquals(r1.ok, true);
      assertEquals(r1.mode, "created");
      assert(/^[A-Za-z0-9_-]{32}$/.test(r1.edit_token));

      const r2 = await (await h(post(body))).json();
      assertEquals(r2.mode, "updated", "retry with same request id must not duplicate");

      const r3 = await (await h(post({ action: "submit", edit_token: r2.edit_token, guest_name: "اختبار تكامل", attendance: "declined", guest_count: 4 }))).json();
      assertEquals(r3.response.guest_count, 0);
      assertEquals(r3.response.attendance, "declined");

      const over = await h(post({ ...body, request_id: crypto.randomUUID(), guest_count: 50 }));
      assertEquals(over.status, 422);
      assertEquals((await over.json()).error, "guest_count_exceeds_limit");

      const ctx = await (await h(post({ action: "context" }))).json();
      assertEquals(ctx.ok, true);
      assertEquals(ctx.settings.groom_name, "يوسف");
      assertEquals(ctx.response, null);

      const bad = await (await h(post({ action: "context", invite_token: "garbage" }))).json();
      assertEquals(bad.invitation.status, "invalid");
    } finally {
      await db.close();
    }
  },
});
