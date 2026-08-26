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
    const safeFileName = (meta.name || `${book.title}.epub`).replace(/["\\]/g, '_');
    const attachmentMimeType = meta.mimeType || 'application/octet-stream';

    // 4. Construct MIME Message (RFC 5322) and stream it to Gmail instead of
    // materializing a full base64 copy + a full joined-message copy in memory
    // (that combination was what blew past the edge function memory limit).
    const boundary = "sloth_library_boundary";
    const textEncoder = new TextEncoder();

    const header = [
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
    ].join("\r\n") + "\r\n";

    const footer = `\r\n--${boundary}--`;

    // Multiple of 3 so each chunk's base64 encoding is self-contained (no padding mid-stream).
    const CHUNK_SIZE = 900_000;

    async function* mimeMessageChunks() {
      yield textEncoder.encode(header);
      for (let offset = 0; offset < fileBytes.length; offset += CHUNK_SIZE) {
        const slice = fileBytes.subarray(offset, offset + CHUNK_SIZE);
        yield textEncoder.encode(encode(slice));
      }
      yield textEncoder.encode(footer);
    }

    // 5. Send via Gmail upload API, streaming the body chunk by chunk
    const gmailResponse = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerToken}`,
        'Content-Type': 'message/rfc822',
      },
      body: ReadableStream.from(mimeMessageChunks()),
      // Required by the Fetch spec when streaming a request body.
      duplex: 'half',
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
