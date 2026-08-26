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

    // This is called by the client with the caller's own session, not the
    // service role key, so authenticate the caller and use their own id —
    // never the user_id from the request body — for the lookups below.
    // Otherwise any authenticated user could pass someone else's user_id
    // and read that person's push token / unread notifications.
    const authClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user: caller }, error: authError } = await authClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const user_id = caller.id;

    // Get user's push token and unread notifications
    const [userRes, notificationsRes] = await Promise.all([
      supabaseClient
        .from('profiles')
        .select('push_token')
        .eq('id', user_id)
        .single(),
      supabaseClient
        .from('notifications')
        .select('id, type, title, body, created_at')
        .eq('user_id', user_id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(50), // Limit to prevent spam
    ]);

    const user = userRes.data;
    const notifications = notificationsRes.data;

    if (!user?.push_token) {
      return new Response(
        JSON.stringify({ success: true, message: 'No push token for user', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!notifications || notifications.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No unread notifications', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send push notifications for all unread notifications
    const pushTokens = [user.push_token];
    const expoApiUrl = 'https://exp.host/--/api/v2/push/send';

    let sentCount = 0;

    for (const notification of notifications) {
      try {
        const pushPayload = {
          to: pushTokens,
          sound: 'default',
          title: notification.title,
          body: notification.body,
          data: {
            type: notification.type,
            notificationId: notification.id,
          },
        };

        const response = await fetch(expoApiUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pushPayload),
        });

        if (response.ok) {
          sentCount++;
          // Optional: Mark as sent by adding metadata
          console.log(`Sent push for notification ${notification.id}`);
        }
      } catch (error) {
        console.error(`Error sending push for notification ${notification.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed existing notifications`,
        sent: sentCount,
        total: notifications.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
