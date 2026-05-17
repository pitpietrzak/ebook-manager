-- Insert/update system version for Android 1.1.3
-- Build URL from EAS build cf6a4db8-e53c-4e60-9351-bb7dfd8a82c6

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.1.3',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/cf6a4db8-e53c-4e60-9351-bb7dfd8a82c6',
  'Dashboard now uses tabs for Collections and Series, library view toggle moved from Profile to Library, and series/collections dashboard layout consistency improvements.',
  false
)
on conflict (platform) do update
  set version       = excluded.version,
      download_url  = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
