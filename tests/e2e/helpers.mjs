// أدوات مشتركة لاختبارات المتصفح.
import { execFileSync } from 'node:child_process';
import { TEST_ANON_KEY } from '../support/jwt.mjs';

export const GATEWAY = 'http://127.0.0.1:54321';

/** تنفيذ SQL على قاعدة الاختبار المحلية كمالك القاعدة وإرجاع النتيجة كـ JSON. */
export function sql(query) {
  const out = execFileSync('psql', ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'], { input: query }).toString().trim();
  return out;
}
export function sqlJson(query) {
  const out = sql(`select coalesce(json_agg(t), '[]') from (${query}) t;`);
  return JSON.parse(out);
}

export function resetData() {
  sql(`delete from public.rsvp_responses; delete from public.invitations; delete from public.rsvp_rate_limits;
       update public.wedding_settings set max_guests_per_response = 5, allow_open_rsvp = true, rsvp_open = true,
         rsvp_deadline = null, maps_url = null, duration_minutes = null, show_calendar_button = true,
         groom_name = 'يوسف', bride_name = 'شذى', event_date = '2027-05-27', event_time = '16:00', timezone = 'Asia/Baghdad', venue_name = 'مزرعة الفرح', venue_address = 'العابات على نهر دجلة',
         verse_text = default, intro_line = default, tagline = default, invitation_message = default, details_title = default, countdown_title = default, countdown_done_text = default, actions_title = default, rsvp_title = default, rsvp_lead = default, footer_text = default, show_children_note = default, children_note_title = default, children_note_body = default, share_closing_text = default, whatsapp_number = default, site_url = default,
         intro_enabled = default, effects_enabled = default, music_enabled = default, music_url = default, theme = default where id = 1;`);
}

/** إنشاء دعوة كمدير عبر الدالة الحقيقية admin_create_invitation. */
export function createInvitation(label, maxGuests = null) {
  const out = sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false) \\g /dev/null
    select public.admin_create_invitation('${label.replace(/'/g, "''")}', ${maxGuests ?? 'null'}, null)::text;`);
  return JSON.parse(out.split('\n').pop());
}

/** حقن إعدادات الربط بالبيئة المحلية (بدل تعديل js/config.js). */
export async function useLocalSupabase(page, { keepIntro = false } = {}) {
  await page.addInitScript(([url, key, keep]) => {
    window.WEDDING_RUNTIME_CONFIG = { supabase: { url, anonKey: key }, ui: { requestTimeoutMs: 4000 } };
    // تخطي مشهد الظرف في الاختبارات العامة (له اختبارات خاصة)
    try { if (!keep) sessionStorage.setItem('wedding_intro_opened', '1'); } catch (e) { /* ignore */ }
  }, [GATEWAY, TEST_ANON_KEY, keepIntro]);
  // الخطوط الخارجية غير ضرورية للاختبار
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
}
