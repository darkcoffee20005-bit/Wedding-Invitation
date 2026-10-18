#!/usr/bin/env bash
# يعيد توليد supabase/setup_all.sql من ملفات supabase/migrations (لا تعدّله يدويًا).
set -euo pipefail
cd "$(dirname "$0")/.."
head -n 7 supabase/setup_all.sql > /tmp/setup_head.sql
{ cat /tmp/setup_head.sql
  for f in supabase/migrations/0*.sql; do printf '\n\n-- >>>>>>>>>> %s\n' "$(basename "$f")"; cat "$f"; done
  sed -n '/-- >>>>>>>>>> التحقق النهائي/,$p' supabase/setup_all.sql | sed '1s/^/\n\n/'
} > /tmp/setup_all.sql
mv /tmp/setup_all.sql supabase/setup_all.sql
echo "supabase/setup_all.sql regenerated"
