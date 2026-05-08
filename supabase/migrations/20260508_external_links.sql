alter table public.books
  add column if not exists lubimyczytac_url text,
  add column if not exists goodreads_url text;

create index if not exists books_lubimyczytac_url_idx
  on public.books (lubimyczytac_url)
  where lubimyczytac_url is not null;

create index if not exists books_goodreads_url_idx
  on public.books (goodreads_url)
  where goodreads_url is not null;
