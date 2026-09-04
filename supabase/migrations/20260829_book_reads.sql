-- Per-user "read" tracking for books. Kept separate from book_ratings
-- since a rating requires a 1-5 star value, but marking something read
-- shouldn't require rating it.

create table if not exists public.book_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  read_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (user_id, book_id)
);

alter table public.book_reads enable row level security;

create policy "Users can view their own read books"
  on public.book_reads for select
  using (auth.uid() = user_id);

create policy "Users can mark their own books as read"
  on public.book_reads for insert
  with check (auth.uid() = user_id);

create policy "Users can unmark their own books as read"
  on public.book_reads for delete
  using (auth.uid() = user_id);
