alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.book_link_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  book_id uuid not null references public.books(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  link_type text not null check (link_type in ('goodreads', 'lubimyczytac')),
  current_url text,
  proposed_url text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamp with time zone,
  admin_note text
);

create index if not exists idx_book_link_reports_status_created_at
  on public.book_link_reports(status, created_at desc);

create index if not exists idx_book_link_reports_book_id
  on public.book_link_reports(book_id);

alter table public.book_link_reports enable row level security;

create or replace function public.set_book_link_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_book_link_reports_updated_at on public.book_link_reports;
create trigger trg_book_link_reports_updated_at
before update on public.book_link_reports
for each row execute function public.set_book_link_reports_updated_at();

drop policy if exists "Users can submit link reports" on public.book_link_reports;
create policy "Users can submit link reports"
  on public.book_link_reports
  for insert
  to authenticated
  with check (
    auth.uid() = reporter_user_id
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

drop policy if exists "Users can view own and admins all link reports" on public.book_link_reports;
create policy "Users can view own and admins all link reports"
  on public.book_link_reports
  for select
  to authenticated
  using (
    auth.uid() = reporter_user_id
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

drop policy if exists "Admins can update link reports" on public.book_link_reports;
create policy "Admins can update link reports"
  on public.book_link_reports
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

create or replace function public.accept_link_report(
  p_report_id uuid,
  p_admin_note text default null
)
returns public.book_link_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_report public.book_link_reports;
begin
  select coalesce(p.is_admin, false)
    into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  if not v_is_admin then
    raise exception 'Only admins can accept link reports';
  end if;

  select *
    into v_report
  from public.book_link_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'Link report not found';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'Only pending reports can be accepted';
  end if;

  if v_report.link_type = 'goodreads' then
    update public.books
    set goodreads_url = v_report.proposed_url
    where id = v_report.book_id;
  elsif v_report.link_type = 'lubimyczytac' then
    update public.books
    set lubimyczytac_url = v_report.proposed_url
    where id = v_report.book_id;
  else
    raise exception 'Unsupported link type: %', v_report.link_type;
  end if;

  update public.book_link_reports
  set
    status = 'accepted',
    reviewed_by = v_uid,
    reviewed_at = timezone('utc'::text, now()),
    admin_note = p_admin_note
  where id = p_report_id
  returning * into v_report;

  return v_report;
end;
$$;

create or replace function public.reject_link_report(
  p_report_id uuid,
  p_admin_note text default null
)
returns public.book_link_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_report public.book_link_reports;
begin
  select coalesce(p.is_admin, false)
    into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  if not v_is_admin then
    raise exception 'Only admins can reject link reports';
  end if;

  select *
    into v_report
  from public.book_link_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    raise exception 'Link report not found';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'Only pending reports can be rejected';
  end if;

  update public.book_link_reports
  set
    status = 'rejected',
    reviewed_by = v_uid,
    reviewed_at = timezone('utc'::text, now()),
    admin_note = p_admin_note
  where id = p_report_id
  returning * into v_report;

  return v_report;
end;
$$;

grant execute on function public.accept_link_report(uuid, text) to authenticated;
grant execute on function public.reject_link_report(uuid, text) to authenticated;