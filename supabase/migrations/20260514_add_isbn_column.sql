-- Add ISBN column to books table for ISBN-based book identification
ALTER TABLE public.books ADD COLUMN isbn text;

-- Create index on ISBN for faster lookups
CREATE INDEX idx_books_isbn ON public.books(isbn);
