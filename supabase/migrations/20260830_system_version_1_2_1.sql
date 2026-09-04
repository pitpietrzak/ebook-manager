-- Insert/update system version for Android 1.2.1
-- Build URL from EAS build d5ed659e-a71a-4475-8a87-fbeaceebfab5

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.2.1',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/d5ed659e-a71a-4475-8a87-fbeaceebfab5',
  'Fixed the library losing your scroll position after opening a book. Star ratings now respond instantly and show a spinner while saving. New: you can mark books as Read, see a checkmark on read books in your library, and see how many books you''ve read on your profile.',
  false
)
on conflict (platform) do update
  set version       = excluded.version,
      download_url  = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
