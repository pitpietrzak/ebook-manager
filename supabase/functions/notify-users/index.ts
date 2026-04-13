import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const { record, table, type } = await req.json();

    if (table === 'books' && type === 'INSERT') {
      const book = record;
      
      // Get uploader name
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('display_name')
        .eq('id', book.user_id)
        .single();
      
      const uploaderName = profile?.display_name || 'Someone';

      // Create in-app notifications for all users except uploader
      const { data: allUsers } = await supabaseClient
        .from('profiles')
        .select('id, push_token')
        .neq('id', book.user_id);

      if (allUsers && allUsers.length > 0) {
        // 1. Insert into notifications table
        const notificationsData = allUsers.map(u => ({
          type: 'new_book',
          title: 'New Book Added! 📚',
          body: `${uploaderName} just added "${book.title}" to the library.`,
          user_id: u.id,
          book_id: book.id
        }));

        await supabaseClient.from('notifications').insert(notificationsData);

        // 2. Send Push Notifications via Expo
        const pushMessages = allUsers
          .filter(u => u.push_token)
          .map(u => ({
            to: u.push_token,
            sound: 'default',
            title: 'New Book Added! 📚',
            body: `${uploaderName} just added "${book.title}" to the library.`,
            data: { bookId: book.id },
          }));

        if (pushMessages.length > 0) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Accept-encoding': 'gzip, deflate',
            },
            body: JSON.stringify(pushMessages),
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
