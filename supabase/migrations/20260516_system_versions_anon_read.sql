-- Allow unauthenticated (anon) users to read system_versions.
-- The VersionProvider mounts before auth is established, so the existing
-- "authenticated only" policy silently returns nothing on startup.

create policy "Anyone can view system versions"
  on public.system_versions
  for select
  to anon
  using (true);
