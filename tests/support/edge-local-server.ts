// للاختبار المحلي فقط: يشغّل handler الـ Edge Function الحقيقي على منفذ محلي
// متصلًا بقاعدة PostgreSQL محلية (scripts/test-db.sh مع KEEP_DB=1).
//   deno run -A tests/support/edge-local-server.ts
import { createHandler } from "../../supabase/functions/rsvp/handler.ts";
import { createPgRpc } from "./pg-rpc.ts";

const db = createPgRpc(Deno.env.get("TEST_DATABASE_URL") ?? "postgres://postgres@127.0.0.1:54329/postgres");
const port = Number(Deno.env.get("EDGE_PORT") ?? 54330);

const handler = createHandler({
  rpc: db.rpc,
  ipSalt: "local-test-salt-not-secret",
  allowedOrigins: ["*"],
  // حدود مرتفعة لأن كل الاختبارات تأتي من نفس العنوان المحلي.
  submitLimit: Number(Deno.env.get("RSVP_SUBMIT_LIMIT") ?? 1000),
  contextLimit: 1000,
  logError: () => {},
});

Deno.serve({ port, hostname: "127.0.0.1", onListen: () => console.log(`edge-local listening on ${port}`) }, handler);
