-- Insert/update system version for Android 1.1.0
-- Download URL: replace with your actual APK/Play Store link before running

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.1.0',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/ed35bd73-bc96-4850-95d9-2d08e2e9a00e',
  'Move books between folders, admin link editing, collapsible admin queue, icon-only verification badges.',
  false
)
on conflict (platform) do update
  set version      = excluded.version,
      download_url = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
