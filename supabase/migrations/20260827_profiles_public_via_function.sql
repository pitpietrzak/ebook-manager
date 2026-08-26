-- Supabase's Security Advisor flags profiles_public because a plain view
-- silently runs with its owner's privileges rather than the querying
-- user's — that's exactly the (intentional) mechanism that let it bypass
-- the profiles RLS policy to expose display_name/avatar_url/email across
-- users. Replace it with an explicit SECURITY DEFINER function instead:
-- same privilege escalation, but declared on purpose, scoped to a fixed
-- column list, and with search_path pinned so it can't be hijacked by a
-- session-local search_path change.

drop view if exists public.profiles_public;

create or replace function public.get_public_profiles(profile_ids uuid[])
returns table (id uuid, display_name text, avatar_url text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select id, display_name, avatar_url, email
  from public.profiles
  where id = any(profile_ids);
$$;

grant execute on function public.get_public_profiles(uuid[]) to authenticated;
