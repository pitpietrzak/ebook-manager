// Keeps the user's Google refresh token server-side and mints short-lived
// access tokens from it. Used by the web build, where storing a long-lived
// Drive/Gmail refresh token in localStorage would be unsafe, and where Google
// requires the client secret to refresh tokens for a "Web application" client.
//
// Actions (POST JSON body):
//   { action: 'store', refreshToken }  -> saves/replaces the caller's token
//   { action: 'refresh' }              -> { access_token, expires_in }
//   { action: 'clear' }                -> deletes the caller's token
//
// Required function secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// (the same Web client configured in Supabase Auth > Providers > Google).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const RECONNECT_MESSAGE = 'Google Drive access expired. Reconnect Google Drive from Profile.';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not authenticated' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { action, refreshToken } = await req.json();

    if (action === 'store') {
      if (!refreshToken || typeof refreshToken !== 'string') {
        return json({ error: 'refreshToken is required' }, 400);
      }
      const { error } = await admin
        .from('google_tokens')
        .upsert({ user_id: user.id, refresh_token: refreshToken, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'clear') {
      const { error } = await admin.from('google_tokens').delete().eq('user_id', user.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'refresh') {
      const { data: row, error } = await admin
        .from('google_tokens')
        .select('refresh_token')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!row?.refresh_token) return json({ error: RECONNECT_MESSAGE, code: 'reconnect' }, 401);

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        return json({ error: 'google-token function is missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets' }, 500);
      }

      const googleRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: row.refresh_token,
        }).toString(),
      });
      const data = await googleRes.json();

      if (!googleRes.ok || !data?.access_token) {
        if (data?.error === 'invalid_grant') {
          await admin.from('google_tokens').delete().eq('user_id', user.id);
          return json({ error: RECONNECT_MESSAGE, code: 'reconnect' }, 401);
        }
        return json({ error: data?.error_description || data?.error || 'Could not refresh Google access' }, 502);
      }

      // Google occasionally rotates the refresh token — keep the newest one.
      if (data.refresh_token && data.refresh_token !== row.refresh_token) {
        await admin
          .from('google_tokens')
          .update({ refresh_token: data.refresh_token, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }

      return json({ access_token: data.access_token, expires_in: data.expires_in });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unexpected error' }, 500);
  }
});
