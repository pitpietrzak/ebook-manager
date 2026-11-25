-- Server-side storage for Google OAuth refresh tokens (used by the web app).
-- The browser never holds the long-lived refresh token: it hands it to the
-- `google-token` edge function once after sign-in, and afterwards asks that
-- function for short-lived access tokens.
--
-- RLS is enabled with NO policies, so only the service role (edge functions)
-- can read or write this table. Clients cannot select it, even their own row.

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on public.google_tokens from anon, authenticated;
