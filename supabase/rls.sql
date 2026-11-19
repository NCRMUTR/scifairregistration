-- Row Level Security + grants (v2). Run AFTER functions.sql.
-- Principle: visitors read ONLY: public site_settings, open upload slots, published gallery.
-- Everything about editions/teams is reachable through the SECURITY DEFINER RPCs (public_site, lookup_team …) or by admins.

alter table public.admins          enable row level security;
alter table public.site_settings   enable row level security;
alter table public.editions        enable row level security;
alter table public.teams           enable row level security;
alter table public.members         enable row level security;
alter table public.advisors        enable row level security;
alter table public.consents        enable row level security;
alter table public.upload_slots    enable row level security;
alter table public.uploads         enable row level security;
alter table public.messages        enable row level security;
alter table public.gallery_albums  enable row level security;
alter table public.gallery_photos  enable row level security;
alter table public.backup_log      enable row level security;
alter table public.audit_log       enable row level security;
alter table public.lookup_attempts enable row level security;   -- no policies = no access except definer functions
alter table public.rate_limits     enable row level security;   -- same

-- Start from zero privileges, then grant back what is needed.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public content (RLS below narrows it).
grant select on public.site_settings, public.upload_slots, public.gallery_albums, public.gallery_photos
  to anon, authenticated;

-- Admin tables (RLS below limits every one of these to admins).
grant select, insert, update, delete on
  public.site_settings, public.editions, public.upload_slots, public.teams, public.members, public.advisors,
  public.uploads, public.messages, public.gallery_albums, public.gallery_photos to authenticated;
grant select on public.consents, public.audit_log, public.admins, public.backup_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Public policies
create policy site_settings_public_read on public.site_settings
  for select to anon, authenticated using (is_public);

create policy upload_slots_public_read on public.upload_slots
  for select to anon, authenticated using (is_open);

-- Gallery: published albums of non-draft editions, and the photos inside them.
create policy albums_public_read on public.gallery_albums
  for select to anon, authenticated
  using (is_published and public._edition_public(edition_id));
create policy photos_public_read on public.gallery_photos
  for select to anon, authenticated
  using (exists (select 1 from public.gallery_albums a
                  where a.id = album_id and a.is_published and public._edition_public(a.edition_id)));

-- Admin policies (every table an admin may read/write)
create policy site_settings_admin_all on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy editions_admin_all      on public.editions      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy upload_slots_admin_all  on public.upload_slots  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teams_admin_all         on public.teams         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_admin_all       on public.members       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy advisors_admin_all      on public.advisors      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy uploads_admin_all       on public.uploads       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy messages_admin_all      on public.messages      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy albums_admin_all        on public.gallery_albums for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy photos_admin_all        on public.gallery_photos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy consents_admin_read     on public.consents      for select to authenticated using (public.is_admin());
create policy backup_admin_read       on public.backup_log    for select to authenticated using (public.is_admin());
create policy audit_admin_read        on public.audit_log     for select to authenticated using (public.is_admin());
create policy admins_self_read        on public.admins        for select to authenticated using (user_id = auth.uid());

-- Public RPCs
grant execute on function public.public_site()                                                     to anon, authenticated;
grant execute on function public._edition_public(uuid)                                             to anon, authenticated;
grant execute on function public.student_id_taken(text)                                            to anon, authenticated;
grant execute on function public.submit_team(text, text, text, jsonb, jsonb, boolean, boolean)    to anon, authenticated;
grant execute on function public.lookup_team(text, text)                                           to anon, authenticated;
grant execute on function public.confirm_upload(text, text, uuid, text, text, bigint)              to anon, authenticated;
grant execute on function public.send_message(text, text, text)                                    to anon, authenticated;
-- Admin-only (each function re-checks is_admin())
grant execute on function public.is_admin()                                                        to authenticated;
grant execute on function public.admin_reset_pin(uuid, text)                                       to authenticated;
grant execute on function public.admin_create_edition(int, uuid)                                   to authenticated;
grant execute on function public.admin_set_current_edition(uuid)                                   to authenticated;
grant execute on function public.admin_mark_backup(uuid, jsonb)                                    to authenticated;
-- Edge Functions only (service role)
grant execute on function public._prepare_upload(text, text, uuid, text, bigint)                   to service_role;
grant execute on function public._purge_edition(uuid, text, uuid)                                  to service_role;
grant execute on function public._edition_file_paths(uuid)                                         to service_role;
