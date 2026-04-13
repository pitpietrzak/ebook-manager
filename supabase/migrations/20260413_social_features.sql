-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  push_token TEXT,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  kindle_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone" 
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- 2. Book Ratings Table
CREATE TABLE IF NOT EXISTS public.book_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, book_id)
);

ALTER TABLE public.book_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ratings are viewable by everyone" 
  ON public.book_ratings FOR SELECT USING (true);

CREATE POLICY "Authenticated users can rate books" 
  ON public.book_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can edit their own ratings" 
  ON public.book_ratings FOR UPDATE USING (auth.uid() = user_id);

-- 3. In-app Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'new_book' | 'new_rating'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- targeted user (optional)
  book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE TO authenticated USING (user_id IS NULL OR auth.uid() = user_id);

-- 4. Enable Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- 4. Trigger to automatically create a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (new.id, new.email, split_part(new.email, '@', 1));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if trigger exists before creating
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
  END IF;
END $$;

-- 6. Trigger to notify users on new book
-- Assuming the Edge Function URL is known or will be configured
-- For now, we set up the trigger to call the webhook
CREATE OR REPLACE FUNCTION public.notify_on_new_book()
RETURNS TRIGGER AS $$
BEGIN
  -- We call the edge function via net.http_post if available, 
  -- or use Supabase's built-in Webhook feature if configured in dashboard.
  -- For now, we perform the notification logic inside the Edge Function.
  -- To trigger it from SQL:
  PERFORM
    net.http_post(
      url:='https://[PROJECT_ID].supabase.co/functions/v1/notify-users',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer [SERVICE_ROLE_KEY]"}'::jsonb,
      body:=jsonb_build_object('record', row_to_json(NEW), 'table', 'books', 'type', 'INSERT')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: 'net' extension must be enabled. If not, the user can set up a Webhook in the Supabase UI.
-- create trigger on_book_created
--   after insert on public.books
--   for each row execute procedure public.notify_on_new_book();

