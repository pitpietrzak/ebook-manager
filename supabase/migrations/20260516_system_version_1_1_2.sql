-- Insert/update system version for Android 1.1.2
-- Download URL: replace with actual EAS build URL after build completes

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.1.2',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/8c2d53c1-edc0-41b5-88a1-ec0887ad429f',
  'Fix update-check logic, add up-to-date alert, allow all users to set series, and improve Android series popup keyboard behavior.',
  false
)
on conflict (platform) do update
  set version      = excluded.version,
      download_url = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
