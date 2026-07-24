-- Fix notify trigger to tolerate missing app.* settings.
-- This prevents book insert failures (e.g. from process-ebook) when
-- app.supabase_url / app.service_role_key are not configured as GUCs.

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
  v_supabase_url := nullif(current_setting('app.supabase_url', true), '');
  v_service_role_key := nullif(current_setting('app.service_role_key', true), '');

  -- If settings are missing, skip push dispatch but keep insert successful.
  if v_supabase_url is null or v_service_role_key is null then
    return new;
  end if;

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
