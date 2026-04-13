import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { bookId, email, providerToken } = await req.json();
    console.log(`[SendToKindle] Invoked: book=${bookId}, email=${email}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Fetch book details
    const { data: book, error: bookError } = await supabaseClient
      .from('books')
      .select('title, drive_file_id')
      .eq('id', bookId)
      .single();

    if (bookError || !book) throw new Error('Book not found');

    // 2. Fetch the file from Google Drive
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${book.drive_file_id}?alt=media`, {
      headers: { Authorization: `Bearer ${providerToken}` }
    });

    if (!driveResponse.ok) {
      throw new Error(`Failed to download from Google Drive: ${driveResponse.statusText}`);
    }

    const fileBuffer = await driveResponse.arrayBuffer();
    const base64Content = encode(fileBuffer);

    // 3. Send email via Brevo API
    const brevoKey = Deno.env.get('BREVO_API_KEY');
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': brevoKey || '',
      },
      body: JSON.stringify({
        sender: { name: "Sloth Library", email: "noreply@sloth-library.net" },
        to: [{ email: email }],
        subject: `Kindle: ${book.title}`,
        htmlContent: `<p>A book has been sent to your Kindle: <strong>${book.title}</strong></p>`,
        attachment: [
          {
            content: base64Content,
            name: `${book.title.replace(/[^a-zA-Z0-9]/g, '_')}.epub`,
          }
        ]
      }),
    });

    if (!brevoResponse.ok) {
        const errorData = await brevoResponse.json();
        throw new Error(`Brevo error: ${JSON.stringify(errorData)}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('send-to-kindle error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
