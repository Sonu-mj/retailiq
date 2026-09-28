-- RetailIQ product image storage
-- Run once in the Supabase SQL Editor after phase7_auth_rls.sql.
-- The bucket stays private. Signed URLs are created by authenticated server actions.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Active RetailIQ employees may read product images through short-lived signed URLs.
drop policy if exists "retailiq product images read" on storage.objects;
create policy "retailiq product images read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_profile_role() is not null
);

-- Only an authenticated RetailIQ owner may upload. Files must live in that
-- owner's UUID folder; the application writes paths as <auth.uid()>/<uuid>.<ext>.
drop policy if exists "retailiq owners upload product images" on storage.objects;
create policy "retailiq owners upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_owner()
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- No update or delete policy is granted. Replacing/removing an image updates
-- only the product reference, so deactivation and historical records never
-- delete stored image bytes automatically.
