#!/usr/bin/env bash
# يشغّل PostgreSQL محليًا مؤقتًا، يطبّق ملف المحاكاة ثم الترحيلات ثم الاختبارات.
# يتطلب PostgreSQL 15+ مثبتًا (initdb, pg_ctl, psql). لا يحتاج Supabase.
# الاستخدام: bash scripts/test-db.sh            (ينشئ قاعدة ويحذفها بعد الانتهاء)
#            KEEP_DB=1 bash scripts/test-db.sh  (يبقيها تعمل للاختبارات اللاحقة على المنفذ 54329)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PGPORT_TEST:-54329}"
DATA="${PGDATA_TEST:-${TMPDIR:-/tmp}/wedding-pg-test}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

cleanup() { if [ -z "${KEEP_DB:-}" ]; then "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DATA"; fi; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
rm -rf "$DATA"; mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown postgres "$DATA"
"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA/server.log" -w start >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/local_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# التحقق من أن الترحيلات قابلة لإعادة التشغيل
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "→ migrations re-applied successfully (idempotent)"

if [ -n "${SKIP_DB_TESTS:-}" ]; then echo "→ database ready on port $PORT (tests skipped)"; exit 0; fi
"${PSQL[@]}" -f "$ROOT/supabase/tests/database_tests.sql" -t 2>&1 | grep -E 'PASS|FAIL|ERROR|ALL DATABASE' | sed 's/^psql:[^ ]* NOTICE:  //' | tee "${TMPDIR:-/tmp}/wedding-db-test.log"
grep -q 'ALL DATABASE TESTS PASSED' "${TMPDIR:-/tmp}/wedding-db-test.log" || { echo 'DATABASE TESTS FAILED'; exit 1; }
echo "PASS count: $(grep -c '^PASS' "${TMPDIR:-/tmp}/wedding-db-test.log")"
