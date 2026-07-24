-- Insert/update system version for Android 1.1.4
-- Build URL from EAS build b4a5cf11-ed91-443c-84e6-cb3289efae39

insert into public.system_versions (platform, version, download_url, release_notes, is_required)
values (
  'android',
  '1.1.4',
  'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/b4a5cf11-ed91-443c-84e6-cb3289efae39',
  'Added reviewer details in dashboard reactions and a new Show Reviews modal in book details. Improved push notification recovery and existing notification processing flow.',
  false
)
on conflict (platform) do update
  set version       = excluded.version,
      download_url  = excluded.download_url,
      release_notes = excluded.release_notes,
      is_required   = excluded.is_required,
      updated_at    = timezone('utc'::text, now());
