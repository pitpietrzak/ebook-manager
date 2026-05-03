alter table public.books
  add column if not exists drive_uploaded_at timestamp with time zone;

update public.books
set drive_uploaded_at = created_at
where drive_uploaded_at is null;

create index if not exists books_drive_uploaded_at_idx
  on public.books (drive_uploaded_at desc);
