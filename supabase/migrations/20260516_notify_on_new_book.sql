-- Notify all users (except the uploader) when a new book is added to the library.

create or replace function public.notify_users_on_new_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (type, title, body, user_id, book_id)
  select
    'new_book',
    'New book added',
    format('"%s" by %s has been added to the library.', coalesce(new.title, 'Untitled'), coalesce(new.author, 'Unknown author')),
    p.id,
    new.id
  from public.profiles p
  where coalesce(p.notifications_enabled, true) = true
    and p.id is distinct from new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_books_notify_users_on_new_book on public.books;
create trigger trg_books_notify_users_on_new_book
after insert on public.books
for each row execute function public.notify_users_on_new_book();
