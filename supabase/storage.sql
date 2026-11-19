-- Storage buckets and policies (v2). Run AFTER rls.sql.
--   public-assets : logo, per-year background image, per-year project PDF   (anyone reads; only admins write)
--   gallery       : event photos (resized copies + thumbnails made in the browser)  (anyone reads; only admins write)
--   team-files    : files sent by teams  (private; admins read/delete; teams upload via signed URLs)
-- NOTE: free Supabase plans have a small total storage quota — the admin page resizes photos before upload,
--       and an album can instead link to an external album (gallery_albums.external_url).

insert into storage.buckets (id, name, public, file_size_limit)
values ('public-assets', 'public-assets', true, 20 * 1024 * 1024)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('team-files', 'team-files', false, 50 * 1024 * 1024)
on conflict (id) do nothing;

create policy "public-assets: anyone reads" on storage.objects
  for select using (bucket_id = 'public-assets');
create policy "public-assets: admin writes" on storage.objects
  for all to authenticated
  using (bucket_id = 'public-assets' and public.is_admin())
  with check (bucket_id = 'public-assets' and public.is_admin());

create policy "gallery: anyone reads" on storage.objects
  for select using (bucket_id = 'gallery');
create policy "gallery: admin writes" on storage.objects
  for all to authenticated
  using (bucket_id = 'gallery' and public.is_admin())
  with check (bucket_id = 'gallery' and public.is_admin());

create policy "team-files: admin reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-files' and public.is_admin());
create policy "team-files: admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-files' and public.is_admin());

-- Team uploads use signed upload URLs created by the `request-upload` Edge Function
-- (service role bypasses RLS), so NO insert policy for anon/authenticated is needed or wanted.
