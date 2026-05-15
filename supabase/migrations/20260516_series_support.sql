-- Series support: allow grouping books into ordered series

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null
);

-- Case-insensitive uniqueness for series names
create unique index if not exists series_name_lower_unique_idx
  on public.series ((lower(name)));

alter table public.series enable row level security;

create policy "Authenticated users can select series"
  on public.series for select to authenticated using (true);

create policy "Authenticated users can insert series"
  on public.series for insert to authenticated with check (true);

create policy "Authenticated users can update series"
  on public.series for update to authenticated using (true);

alter table public.books
  add column if not exists series_id uuid references public.series(id) on delete set null,
  add column if not exists series_part numeric(6,2);

alter table public.books
  drop constraint if exists books_series_part_positive;

alter table public.books
  add constraint books_series_part_positive check (series_part is null or series_part > 0);

create index if not exists books_series_id_idx on public.books(series_id);
create index if not exists books_series_part_idx on public.books(series_part);
