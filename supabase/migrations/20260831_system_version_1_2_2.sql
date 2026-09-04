-- Insert/update system version for Android 1.2.2
-- Build URL from EAS build 5f90afab-693c-4590-9782-e71939e617be

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.2.2',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/5f90afab-693c-4590-9782-e71939e617be',
  'Fixed the app signing you out just because your Google Drive connection needed a refresh — you''ll now stay logged in, and can reconnect Google Drive anytime from Profile if needed.',
  false
)
on conflict (platform) do update
  set version       = excluded.version,
      download_url  = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
