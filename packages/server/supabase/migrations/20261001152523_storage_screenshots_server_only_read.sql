-- Screenshots are read only through server-minted signed URLs (service role,
-- _shared/storage.ts); there is no client read path.
drop policy if exists screenshots_owner_select on storage.objects;
