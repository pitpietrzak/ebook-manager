-- Allow decimal series parts like 0.1, 0.4, 0.7 for prequels/interquels

alter table public.books
  drop constraint if exists books_series_part_positive;

alter table public.books
  alter column series_part type numeric(6,2)
  using series_part::numeric;

alter table public.books
  add constraint books_series_part_positive
  check (series_part is null or series_part > 0);
