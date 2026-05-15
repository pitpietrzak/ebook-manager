create table if not exists public.system_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  platform text not null check (platform in ('ios', 'android')),
  version text not null,
  download_url text not null,
  release_notes text,
  is_required boolean not null default false,
  unique(platform)
);

alter table public.system_versions enable row level security;

create policy "Authenticated users can view system versions"
  on public.system_versions
  for select
  to authenticated
  using (true);

create or replace function public.set_system_versions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_system_versions_updated_at on public.system_versions;
create trigger trg_system_versions_updated_at
before update on public.system_versions
for each row execute function public.set_system_versions_updated_at();
