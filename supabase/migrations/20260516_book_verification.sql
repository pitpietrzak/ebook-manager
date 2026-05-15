alter table public.books
  add column if not exists verified boolean not null default false,
  add column if not exists verified_at timestamp with time zone,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_books_verified_created_at
  on public.books(verified, created_at desc);

create or replace function public.verify_book(
  p_book_id uuid
)
returns public.books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_book public.books;
begin
  select coalesce(p.is_admin, false)
    into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  if not v_is_admin then
    raise exception 'Only admins can verify books';
  end if;

  update public.books
  set
    verified = true,
    verified_at = timezone('utc'::text, now()),
    verified_by = v_uid
  where id = p_book_id
  returning * into v_book;

  if v_book.id is null then
    raise exception 'Book not found';
  end if;

  return v_book;
end;
$$;

grant execute on function public.verify_book(uuid) to authenticated;

create or replace function public.guard_book_verification_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
begin
  if new.verified is distinct from old.verified
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at then
    select coalesce(p.is_admin, false)
      into v_is_admin
    from public.profiles p
    where p.id = v_uid;

    if not v_is_admin then
      raise exception 'Only admins can change verification state';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_books_guard_verification_updates on public.books;
create trigger trg_books_guard_verification_updates
before update on public.books
for each row execute function public.guard_book_verification_updates();

create or replace function public.notify_admins_on_unverified_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verified = true then
    return new;
  end if;

  insert into public.notifications (type, title, body, user_id, book_id)
  select
    'book_verification',
    'Book needs verification',
    format('"%s" by %s is waiting for verification.', coalesce(new.title, 'Untitled'), coalesce(new.author, 'Unknown author')),
    p.id,
    new.id
  from public.profiles p
  where coalesce(p.is_admin, false) = true
    and coalesce(p.notifications_enabled, true) = true;

  return new;
end;
$$;

drop trigger if exists trg_books_notify_admins_on_unverified on public.books;
create trigger trg_books_notify_admins_on_unverified
after insert on public.books
for each row execute function public.notify_admins_on_unverified_book();
