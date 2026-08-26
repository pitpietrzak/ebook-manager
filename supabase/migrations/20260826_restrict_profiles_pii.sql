-- Tighten profiles RLS: the previous "viewable by everyone" policy let any
-- authenticated user select push_token and kindle_email for every other
-- user (not just the display_name/email already shown in the UI for
-- attribution), which would let a modified client harvest push tokens or
-- Kindle addresses. Restrict the base table to the owning row, and expose
-- only the already-public attribution fields through a view.

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Owned by the migration role (not `authenticated`), so it runs with that
-- role's privileges and is unaffected by the restrictive policy above —
-- this is what lets it expose the safe columns for every user.
create or replace view public.profiles_public as
  select id, display_name, avatar_url, email
  from public.profiles;

grant select on public.profiles_public to authenticated;
