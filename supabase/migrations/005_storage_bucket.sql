-- ============================================================================
--  UniGuard · 005 · Storage bucket for report photos
--
--  Bucket "reports": private, authenticated upload only, images only, 5 MB cap,
--  and every object path must start with the uploader's own user id
--  (<user_id>/<report_code>/<file>). Reading is limited to the uploader, the
--  officials of that uploader's barangay, and LGU.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------- upload
drop policy if exists reports_objects_insert on storage.objects;
create policy reports_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reports'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------------------------------- read
drop policy if exists reports_objects_read on storage.objects;
create policy reports_objects_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reports'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_lgu()
      or (
        public.is_official()
        and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
             and p.barangay_id = public.my_barangay_id()
        )
      )
    )
  );

-- ------------------------------------------------------------------- delete
drop policy if exists reports_objects_delete on storage.objects;
create policy reports_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reports'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_lgu()
    )
  );

-- Note: updates to objects are intentionally not allowed. Upload a new object
-- and update reports.photo_path instead, so evidence is never silently replaced.
