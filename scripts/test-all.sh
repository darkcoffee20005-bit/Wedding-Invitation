#!/usr/bin/env bash
# يشغّل كل مجموعات الاختبار بالتتابع: الوحدات، قاعدة البيانات، الـ Edge Function، والمتصفح.
#   DENO_BIN=deno POSTGREST_BIN=postgrest bash scripts/test-all.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DENO_BIN="${DENO_BIN:-deno}"
EDGE_DB="${TMPDIR:-/tmp}/wedding-pg-edge"
RUN_AS=(); [ "$(id -u)" = "0" ] && RUN_AS=(runuser -u postgres --)
PG_BIN="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")"

echo "━━ 1/4 وحدات الواجهة"
node --test tests/unit/*.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)'

echo "━━ 2/4 قاعدة البيانات"
PGPORT_TEST=54339 PGDATA_TEST="${TMPDIR:-/tmp}/wedding-pg-dbtest" bash scripts/test-db.sh | tail -n 2

echo "━━ 3/4 الـ Edge Function (مع تكامل PostgreSQL)"
KEEP_DB=1 SKIP_DB_TESTS=1 PGPORT_TEST=54339 PGDATA_TEST="$EDGE_DB" bash scripts/test-db.sh >/dev/null
trap '"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$EDGE_DB" -m fast stop >/dev/null 2>&1 || true; rm -rf "$EDGE_DB"; bash scripts/e2e-stack.sh stop >/dev/null 2>&1 || true' EXIT
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54339/postgres "$DENO_BIN" test -A --node-modules-dir=none \
  supabase/functions/rsvp/handler.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^(ok|FAILED)'
"$DENO_BIN" check --node-modules-dir=none supabase/functions/rsvp/index.ts >/dev/null && echo "deno check: ok"
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$EDGE_DB" -m fast stop >/dev/null; rm -rf "$EDGE_DB"

echo "━━ 4/4 المتصفح (Playwright)"
bash scripts/e2e-stack.sh start >/dev/null 2>&1 </dev/null
npx playwright test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '✘|passed|failed|flaky'
bash scripts/e2e-stack.sh stop >/dev/null 2>&1
echo "━━ اكتملت كل الاختبارات بنجاح"
