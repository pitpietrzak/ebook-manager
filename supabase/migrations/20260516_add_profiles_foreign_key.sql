-- Add explicit foreign key from books.user_id to profiles.id
-- This enables Supabase automatic joins for profiles(display_name, email) in queries
-- The existing reference to auth.users is kept for cascade delete behavior

alter table public.books
add constraint books_user_id_profiles_fkey 
foreign key (user_id) references public.profiles(id) on delete cascade;

create index if not exists idx_books_user_id_profile_join on public.books(user_id);
