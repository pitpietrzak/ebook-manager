-- Notify all users (except the uploader) when a new book is added to the library.

create or replace function public.notify_users_on_new_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uploader_name text;
  v_request_body jsonb;
  v_supabase_url text;
  v_service_role_key text;
begin
  -- Get uploader display name
  select display_name into v_uploader_name from public.profiles where id = new.user_id;
  v_uploader_name := coalesce(v_uploader_name, 'Someone');

  -- 1. Insert in-app notifications
  insert into public.notifications (type, title, body, user_id, book_id)
  select
    'new_book',
    'New Book Added! 📚',
    format('%s just added "%s" to the library.', v_uploader_name, coalesce(new.title, 'Untitled')),
    p.id,
    new.id
  from public.profiles p
  where coalesce(p.notifications_enabled, true) = true
    and p.id is distinct from new.user_id;

  -- 2. Prepare data for edge function call
  v_supabase_url := current_setting('app.supabase_url');
  v_service_role_key := current_setting('app.service_role_key');
  v_request_body := jsonb_build_object('record', row_to_json(new), 'table', 'books', 'type', 'INSERT');

  -- Call edge function to send push notifications (async via http)
  begin
    perform http_post(
      url := v_supabase_url || '/functions/v1/notify-users',
      body := v_request_body::text,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      )
    );
  exception when others then
    -- Log error but don't fail the trigger - book insert should still succeed
    raise warning 'Error calling notify-users function: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_books_notify_users_on_new_book on public.books;
create trigger trg_books_notify_users_on_new_book
after insert on public.books
for each row execute function public.notify_users_on_new_book();
