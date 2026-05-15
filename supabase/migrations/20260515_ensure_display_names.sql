-- Ensure all profile rows have a display_name set from email if missing
-- This fixes the "Added by" missing label issue when display_name is NULL

update public.profiles
set display_name = split_part(email, '@', 1)
where display_name is null or display_name = '';

-- Add a NOT NULL constraint if there are no remaining NULLs
-- (This is commented out as a safety measure; uncomment after verifying no NULLs remain)
-- alter table public.profiles alter column display_name set not null;
