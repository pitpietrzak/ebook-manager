-- Insert/update system version for Android 1.2.0
-- Build URL from EAS build a386a9eb-ba50-485c-bc77-3f4880675ef5

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.2.0',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/a386a9eb-ba50-485c-bc77-3f4880675ef5',
  'You can now open a series to read it in order, tap a mood tag to find similar books, and open a book straight from Drive. Notifications and recent ratings are now in one Activity view (bell icon on the Dashboard). Also fixed a bug that could delete books from large folders during sync, and tightened up privacy on shared profile data.',
  false
)
on conflict (platform) do update
  set version       = excluded.version,
      download_url  = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
