// للاختبار المحلي فقط: تنفيذ rpc() مباشرة على PostgreSQL محلي بدور service_role
// بدلًا من PostgREST، لتشغيل منطق الـ Edge Function الحقيقي ضد قاعدة بيانات حقيقية.
import pg from "npm:pg@8.13.1";
import type { RpcResult } from "../../supabase/functions/rsvp/handler.ts";

export function createPgRpc(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 4 });
  pool.on("connect", (client: pg.PoolClient) => {
    client.query(`set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  });

  async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
    if (!/^[a-z_]+$/.test(fn)) throw new Error("bad fn");
    const names = Object.keys(args);
    names.forEach((n) => { if (!/^[a-z_]+$/.test(n)) throw new Error("bad arg"); });
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as result`;
    try {
      const res = await pool.query(sql, names.map((n) => args[n]));
      return { data: res.rows[0].result, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
    }
  }

  return { rpc, close: () => pool.end() };
}
