-- Collection Icons Table
-- Stores the association between a folder/collection name and a Lucide icon name.
CREATE TABLE IF NOT EXISTS public.collection_icons (
  name TEXT PRIMARY KEY,
  icon_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.collection_icons ENABLE ROW LEVEL SECURITY;

-- Everyone can view icons
CREATE POLICY "Icons are viewable by everyone" 
  ON public.collection_icons FOR SELECT USING (true);

-- Authenticated users (or the service role via Edge Function) can manage icons
-- We use FOR ALL to ensure 'upsert' operations have both INSERT and UPDATE permissions.
CREATE POLICY "Authenticated users can manage icons" 
  ON public.collection_icons FOR ALL TO authenticated USING (true) WITH CHECK (true);
