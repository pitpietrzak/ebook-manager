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
    const { bookId, email } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Fetch book details to get title and drive_file_id
    const { data: book, error: bookError } = await supabaseClient
      .from('books')
      .select('title, drive_file_id')
      .eq('id', bookId)
      .single();

    if (bookError || !book) throw new Error('Book not found');

    // 2. Fetch the file from Google Drive (Needs Service Account or User Token in future)
    // To simplify for this scaffold: you would use googleapis or standard fetch to Google Drive API
    // const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${book.drive_file_id}?alt=media`, {
    //   headers: { Authorization: `Bearer ${userGoogleToken}` }
    // });
    // const fileBuffer = await driveResponse.arrayBuffer();
    // const base64Content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
    const base64Content = "mock_base64_content";

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
        sender: { name: "Family Ebooks", email: "noreply@family-ebooks.net" },
        to: [{ email: email }],
        subject: `Send to Kindle: ${book.title}`,
        htmlContent: `<p>Enjoy your book!</p>`,
        attachment: [
          {
            content: base64Content,
            name: `${book.title}.epub`,
          }
        ]
      }),
    });

    if (!brevoResponse.ok) {
        throw new Error('Failed to send email via Brevo');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
