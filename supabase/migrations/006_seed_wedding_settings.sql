-- =============================================================================
-- 006_seed_wedding_settings.sql
-- بيانات الزفاف الأولية (صف واحد). لا تُضاف أي ردود أو بيانات تجريبية.
-- maps_url و duration_minutes تُترك فارغة لأنها غير محددة بعد؛ عدّلها من لوحة الإدارة.
-- لا يستبدل الإعدادات إن كانت موجودة مسبقًا.
-- =============================================================================
insert into public.wedding_settings (
  id, groom_name, bride_name, event_date, event_time, timezone,
  venue_name, venue_address, maps_url, duration_minutes,
  max_guests_per_response, show_calendar_button, allow_open_rsvp, rsvp_open, rsvp_deadline
) values (
  1, 'يوسف', 'شذى', date '2027-05-27', time '16:00', 'Asia/Baghdad',
  'مزرعة الفرح', 'العابات على نهر دجلة', null, null,
  5, true, true, true, null
)
on conflict (id) do nothing;
