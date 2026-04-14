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
    console.log(`[SendToKindle] Gmail Auth: book=${bookId}, email=${email}`);

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
    const base64Attachment = encode(fileBuffer);
    const safeTitle = book.title.replace(/[^a-zA-Z0-9]/g, '_');

    // 3. Construct MIME Message (RFC 5322)
    const boundary = "sloth_library_boundary";
    const mimeParts = [
      `To: ${email}`,
      `Subject: Convert: ${book.title}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      `Sent from your Sloth Library app.`,
      ``,
      `--${boundary}`,
      `Content-Type: application/epub+zip`,
      `Content-Disposition: attachment; filename="${safeTitle}.epub"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Attachment,
      `--${boundary}--`
    ];

    const mimeMessage = mimeParts.join("\r\n");

    // Convert to base64url (UTF-8 safe)
    const base64Mime = encode(new TextEncoder().encode(mimeMessage))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 4. Send via Gmail API
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: base64Mime
      }),
    });

    if (!gmailResponse.ok) {
        const errorData = await gmailResponse.json();
        throw new Error(`Gmail API error: ${JSON.stringify(errorData)}`);
    }

    return new Response(JSON.stringify({ success: true, message: 'Message sent via Gmail' }), {
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
