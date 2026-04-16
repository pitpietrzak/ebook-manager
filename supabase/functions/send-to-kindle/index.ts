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

    // 2. Check file metadata first to avoid memory blowups on large books
    const metaResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${book.drive_file_id}?fields=name,size,mimeType`,
      { headers: { Authorization: `Bearer ${providerToken}` } }
    );

    if (!metaResponse.ok) {
      throw new Error(`Failed to fetch Google Drive metadata: ${metaResponse.statusText}`);
    }

    const meta = await metaResponse.json();
    const fileSizeBytes = Number(meta.size || 0);
    const maxRecommendedBytes = 18 * 1024 * 1024;

    if (fileSizeBytes > maxRecommendedBytes) {
      throw new Error('This ebook is too large to send through Gmail from the app. Download it and send it to Kindle manually.');
    }

    // 3. Fetch the file from Google Drive
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${book.drive_file_id}?alt=media`, {
      headers: { Authorization: `Bearer ${providerToken}` }
    });

    if (!driveResponse.ok) {
      throw new Error(`Failed to download from Google Drive: ${driveResponse.statusText}`);
    }

    const fileBytes = new Uint8Array(await driveResponse.arrayBuffer());
    const base64Attachment = encode(fileBytes);
    const safeFileName = (meta.name || `${book.title}.epub`).replace(/["\\]/g, '_');
    const attachmentMimeType = meta.mimeType || 'application/octet-stream';

    // 4. Construct MIME Message (RFC 5322)
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
      `Content-Type: ${attachmentMimeType}`,
      `Content-Disposition: attachment; filename="${safeFileName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Attachment,
      `--${boundary}--`
    ];

    const mimeMessage = mimeParts.join("\r\n");

    // 5. Send via Gmail upload API to avoid an extra full-message base64 copy in memory
    const gmailResponse = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerToken}`,
        'Content-Type': 'message/rfc822',
      },
      body: mimeMessage,
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
