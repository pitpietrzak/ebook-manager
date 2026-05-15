-- Enable pgvector extension for AI search
create extension if not exists vector
with
  schema extensions;

-- Create the books table
create table public.books (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  drive_uploaded_at timestamp with time zone,
  title text not null,
  author text,
  genre text,
  description text,
  lubimyczytac_url text,
  goodreads_url text,
  moods text[],          -- an array of moods, e.g. ['sad', 'inspiring']
  folder_tags text[],    -- an array of nested Google Drive parent folders
  drive_file_id text not null unique,  -- Google Drive File ID so we don't duplicate
  isbn text,             -- ISBN for book identification (10 or 13 digit)
  embedding vector(1536), -- 1536 is the dimension for openai text-embedding-3-small
  user_id uuid references auth.users(id) on delete cascade
);

-- Enable Row Level Security (RLS)
alter table public.books enable row level security;

-- Create policies (assuming family members have accounts and share the same library, 
-- we'll allow authenticated users to read and insert)
create policy "Authenticated users can select books"
  on public.books for select to authenticated using (true);

create policy "Authenticated users can insert books"
  on public.books for insert to authenticated with check (true);

create policy "Authenticated users can update books"
  on public.books for update to authenticated using (true);
  
-- Create a function for similarity search (for the AI Search feature)
create or replace function match_books (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  title text,
  author text,
  genre text,
  description text,
  drive_file_id text,
  similarity float
)
language sql stable
as $$
  select
    books.id,
    books.title,
    books.author,
    books.genre,
    books.description,
    books.drive_file_id,
    1 - (books.embedding <=> query_embedding) as similarity
  from books
  where 1 - (books.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;