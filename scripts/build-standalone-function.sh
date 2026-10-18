#!/usr/bin/env bash
# يولّد supabase/functions/rsvp/standalone.ts: الدالة كاملة في ملف واحد
# للصقها في محرر Supabase (Edge Functions → Deploy a new function → Via Editor).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/functions/rsvp/standalone.ts
{
  echo '// ============================================================================='
  echo '// دالة تأكيد الحضور rsvp — نسخة الملف الواحد (مولّدة تلقائيًا، لا تعدّلها يدويًا).'
  echo '// الصقها كاملة في Supabase: Edge Functions → Deploy a new function → Via Editor'
  echo '// واجعل اسم الدالة: rsvp'
  echo '// الأسرار الاختيارية (Edge Functions → Secrets): RSVP_IP_SALT, ALLOWED_ORIGINS, RSVP_SUBMIT_LIMIT'
  echo '// ============================================================================='
  sed -n '/^import { createClient }/p' supabase/functions/rsvp/index.ts
  echo
  sed -e 's/^export //' supabase/functions/rsvp/handler.ts
  echo
  sed -e '/^import /d' -e '/^\/\//d' supabase/functions/rsvp/index.ts
} > "$OUT"
echo "generated $OUT"
