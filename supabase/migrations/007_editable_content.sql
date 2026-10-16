-- =============================================================================
-- 007_editable_content.sql
-- جعل كل نصوص صفحة الدعوة وعناوينها وخيارات المشاركة قابلة للتعديل من لوحة الإدارة.
-- القيم الافتراضية = النصوص الحالية للصفحة (ومنها نص ملاحظة الأطفال حرفيًا).
-- آمن لإعادة التشغيل.
-- =============================================================================

alter table public.wedding_settings
  -- نصوص الافتتاحية (اختيارية: الفراغ يُخفي العنصر)
  add column if not exists verse_text          text default '﴿وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً﴾',
  add column if not exists intro_line          text default 'بكل الحب والفرح',
  add column if not exists tagline             text default 'يتشرفان بدعوتكم لمشاركتهما فرحة حفل زفافهما',
  add column if not exists invitation_message  text default 'بقلوبٍ يملؤها الفرح، وبمشاعر الامتنان لله، يسعدنا أن تكونوا معنا في يومٍ ننتظره بشوق، لنبدأ معًا فصلًا جديدًا من الحياة. حضوركم يكمل فرحتنا ويزيدها جمالًا.',
  -- عناوين الأقسام (مطلوبة)
  add column if not exists details_title       text not null default 'موعد الفرح',
  add column if not exists countdown_title     text not null default 'العد التنازلي ليوم الفرح',
  add column if not exists countdown_done_text text not null default 'حلّ يوم الفرح! شكرًا لمشاركتكم فرحتنا 🤍',
  add column if not exists actions_title       text not null default 'شاركونا الفرحة',
  add column if not exists rsvp_title          text not null default 'هل ستشاركوننا فرحتنا؟',
  add column if not exists rsvp_lead           text default 'يسعدنا تأكيد حضوركم لنستعد لاستقبالكم بأجمل صورة.',
  add column if not exists footer_text         text default 'بانتظاركم لنصنع معًا أجمل الذكريات',
  -- ملاحظة الأطفال (كل سطر = فقرة)
  add column if not exists show_children_note  boolean not null default true,
  add column if not exists children_note_title text not null default 'ملاحظة مهمة لضيوفنا الكرام',
  add column if not exists children_note_body  text default E'نعتذر منكم بكل محبة، ونرجو من ضيوفنا الكرام عدم اصطحاب الأطفال إلى الحفل، حيث إن الدعوة مخصصة للكبار فقط.\nشاكرين لكم تفهّمكم وتعاونكم، ونتطلع إلى مشاركتكم فرحتنا بأجمل الأوقات.',
  -- المشاركة
  add column if not exists share_closing_text  text default 'حضوركم يزيدنا فرحًا وشرفًا، ودمتم بخير ومحبة.',
  add column if not exists whatsapp_number     text,
  add column if not exists site_url            text;

-- القيود (تُضاف مرة واحدة)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_content_lengths') then
    alter table public.wedding_settings add constraint wedding_settings_content_lengths check (
          coalesce(char_length(verse_text), 0)         <= 400
      and coalesce(char_length(intro_line), 0)         <= 120
      and coalesce(char_length(tagline), 0)            <= 200
      and coalesce(char_length(invitation_message), 0) <= 1000
      and char_length(details_title)       between 1 and 80
      and char_length(countdown_title)     between 1 and 80
      and char_length(countdown_done_text) between 1 and 200
      and char_length(actions_title)       between 1 and 80
      and char_length(rsvp_title)          between 1 and 120
      and coalesce(char_length(rsvp_lead), 0)          <= 300
      and coalesce(char_length(footer_text), 0)        <= 200
      and char_length(children_note_title) between 1 and 120
      and coalesce(char_length(children_note_body), 0) <= 1000
      and coalesce(char_length(share_closing_text), 0) <= 300
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_children_note_body') then
    alter table public.wedding_settings add constraint wedding_settings_children_note_body
      check (not show_children_note or children_note_body is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_whatsapp_number') then
    alter table public.wedding_settings add constraint wedding_settings_whatsapp_number
      check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wedding_settings_site_url') then
    alter table public.wedding_settings add constraint wedding_settings_site_url
      check (site_url is null or (site_url ~ '^https://' and char_length(site_url) <= 300));
  end if;
end $$;

-- تطبيع النصوص الجديدة (الفراغ → null) مع إبقاء فحص المنطقة الزمنية.
create or replace function public.wedding_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.groom_name    := public.normalize_single_line(new.groom_name);
  new.bride_name    := public.normalize_single_line(new.bride_name);
  new.venue_name    := public.normalize_single_line(new.venue_name);
  new.venue_address := public.normalize_single_line(new.venue_address);
  new.maps_url      := public.normalize_single_line(new.maps_url);
  new.timezone      := btrim(new.timezone);

  new.verse_text          := public.normalize_multiline(new.verse_text);
  new.intro_line          := public.normalize_single_line(new.intro_line);
  new.tagline             := public.normalize_single_line(new.tagline);
  new.invitation_message  := public.normalize_multiline(new.invitation_message);
  new.details_title       := public.normalize_single_line(new.details_title);
  new.countdown_title     := public.normalize_single_line(new.countdown_title);
  new.countdown_done_text := public.normalize_single_line(new.countdown_done_text);
  new.actions_title       := public.normalize_single_line(new.actions_title);
  new.rsvp_title          := public.normalize_single_line(new.rsvp_title);
  new.rsvp_lead           := public.normalize_single_line(new.rsvp_lead);
  new.footer_text         := public.normalize_single_line(new.footer_text);
  new.children_note_title := public.normalize_single_line(new.children_note_title);
  new.children_note_body  := public.normalize_multiline(new.children_note_body);
  new.share_closing_text  := public.normalize_multiline(new.share_closing_text);
  new.whatsapp_number     := nullif(regexp_replace(coalesce(new.whatsapp_number, ''), '[^0-9]', '', 'g'), '');
  new.site_url            := public.normalize_single_line(new.site_url);

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- صلاحية المدير لتعديل الأعمدة الجديدة (RLS تبقى: is_admin() فقط).
grant update (verse_text, intro_line, tagline, invitation_message, details_title, countdown_title,
              countdown_done_text, actions_title, rsvp_title, rsvp_lead, footer_text,
              show_children_note, children_note_title, children_note_body,
              share_closing_text, whatsapp_number, site_url)
  on public.wedding_settings to authenticated;

-- الإعدادات العامة المعروضة في صفحة الدعوة (بدون أي بيانات مدعوين).
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
    'site_url', s.site_url
  )
  from public.wedding_settings s
  where s.id = 1;
$$;

revoke all on function public.rsvp_public_settings() from public, anon, authenticated;
grant execute on function public.rsvp_public_settings() to service_role;
