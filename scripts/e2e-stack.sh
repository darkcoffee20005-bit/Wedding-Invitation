#!/usr/bin/env bash
# يشغّل بيئة اختبار محلية كاملة لاختبارات Playwright:
#   PostgreSQL (54329) + PostgREST (54331) + Edge Function عبر Deno (54330)
#   + بوابة Supabase محلية (54321) + خادم الملفات الثابتة (5173)
# المتطلبات: PostgreSQL 15+، deno، postgrest (حدد المسارات عبر DENO_BIN و POSTGREST_BIN).
#   bash scripts/e2e-stack.sh start | stop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${TMPDIR:-/tmp}/wedding-e2e"
DENO_BIN="${DENO_BIN:-deno}"
POSTGREST_BIN="${POSTGREST_BIN:-postgrest}"
mkdir -p "$STATE"

stop() {
  for f in "$STATE"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
  if [ -d "$STATE/pg" ]; then
    RUN_AS=(); [ "$(id -u)" = "0" ] && RUN_AS=(runuser -u postgres --)
    PG_BIN="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")"
    "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$STATE/pg" -m fast stop >/dev/null 2>&1 || true
  fi
}

start() {
  stop
  KEEP_DB=1 SKIP_DB_TESTS=1 PGDATA_TEST="$STATE/pg" bash "$ROOT/scripts/test-db.sh"
  psql -h 127.0.0.1 -p 54329 -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'user@test.local')
on conflict do nothing;
insert into public.admin_users (user_id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
SQL
  cat > "$STATE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator-local-test@127.0.0.1:54329/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-test-jwt-secret-at-least-32-characters-long"
server-host = "127.0.0.1"
server-port = 54331
CONF
  nohup "$POSTGREST_BIN" "$STATE/postgrest.conf" > "$STATE/postgrest.log" 2>&1 & echo $! > "$STATE/postgrest.pid"
  (cd "$ROOT" && nohup "$DENO_BIN" run -A --node-modules-dir=none tests/support/edge-local-server.ts > "$STATE/edge.log" 2>&1 & echo $! > "$STATE/edge.pid")
  (cd "$ROOT" && nohup node tests/support/local-gateway.mjs > "$STATE/gateway.log" 2>&1 & echo $! > "$STATE/gateway.pid")
  (cd "$ROOT" && nohup node scripts/serve.mjs > "$STATE/static.log" 2>&1 & echo $! > "$STATE/static.pid")
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null http://127.0.0.1:54331/ && curl -sf -o /dev/null http://127.0.0.1:5173/ \
       && curl -s -o /dev/null -X OPTIONS http://127.0.0.1:54330/ && curl -s -o /dev/null http://127.0.0.1:54321/rest/v1/; then
      echo "e2e stack ready"; return 0; fi
    sleep 1
  done
  echo "stack failed to start; logs in $STATE"; tail -5 "$STATE"/*.log; exit 1
}

case "${1:-start}" in start) start ;; stop) stop ;; *) echo "usage: $0 start|stop"; exit 1 ;; esac
