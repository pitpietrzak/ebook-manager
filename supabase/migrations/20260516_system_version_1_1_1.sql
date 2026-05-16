    -- Insert/update system version for Android 1.1.1
    -- Download URL: replace with actual EAS build URL after build completes

    insert into public.system_versions (platform, version, download_url, release_notes, is_required)
    values (
    'android',
    '1.1.1',
    'https://expo.dev/accounts/pietrzakpiotr1994/projects/ebook-manager/builds/266d2ee9-e8ef-41bf-9f91-d7972b2aace5',
    'Fixed uploader recognition, Series support, in-app notifications when new books are added, sort by series in collection view.',
    false
    )
    on conflict (platform) do update
    set version      = excluded.version,
        download_url = excluded.download_url,
        release_notes = excluded.release_notes,
        is_required   = excluded.is_required,
        updated_at    = timezone('utc'::text, now());
