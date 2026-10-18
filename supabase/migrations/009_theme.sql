-- =============================================================================
-- 009_theme.sql
-- الهوية اللونية للدعوة (تُختار من لوحة الإدارة). آمن لإعادة التشغيل.
-- القيم يجب أن تطابق js/theme.js و css/themes.css.
-- =============================================================================

alter table public.wedding_settings
  add column if not exists theme text not null default 'emerald';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_theme') then
    alter table public.wedding_settings add constraint wedding_settings_theme
      check (theme in ('emerald', 'navy', 'rose-gold', 'burgundy', 'noir', 'olive', 'royal'));
  end if;
end $$;

grant update (theme) on public.wedding_settings to authenticated;

create or replace function public.rsvp_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'groom_name', s.groom_name,
    'bride_name', s.bride_name,
    'event_date', s.event_date,
    'event_time', to_char(s.event_time, 'HH24:MI'),
    'timezone', s.timezone,
    'starts_at', ((s.event_date + s.event_time) at time zone s.timezone),
    'venue_name', s.venue_name,
    'venue_address', s.venue_address,
    'maps_url', s.maps_url,
    'duration_minutes', s.duration_minutes,
    'max_guests_per_response', s.max_guests_per_response,
    'show_calendar_button', s.show_calendar_button,
    'allow_open_rsvp', s.allow_open_rsvp,
    'rsvp_deadline', s.rsvp_deadline,
    'rsvp_open', s.rsvp_open and (s.rsvp_deadline is null or now() < s.rsvp_deadline),
    'verse_text', s.verse_text,
    'intro_line', s.intro_line,
    'tagline', s.tagline,
    'invitation_message', s.invitation_message,
    'details_title', s.details_title,
    'countdown_title', s.countdown_title,
    'countdown_done_text', s.countdown_done_text,
    'actions_title', s.actions_title,
    'rsvp_title', s.rsvp_title,
    'rsvp_lead', s.rsvp_lead,
    'footer_text', s.footer_text,
    'show_children_note', s.show_children_note,
    'children_note_title', s.children_note_title,
    'children_note_body', s.children_note_body,
    'share_closing_text', s.share_closing_text,
    'whatsapp_number', s.whatsapp_number,
    'site_url', s.site_url,
    'intro_enabled', s.intro_enabled,
    'effects_enabled', s.effects_enabled,
    'music_enabled', s.music_enabled,
    'music_url', s.music_url,
    'theme', s.theme
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
grant execute on function public.rsvp_public_settings() to service_role;
