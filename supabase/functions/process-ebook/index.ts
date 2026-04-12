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
    const { driveFileId, fileName, folderTags = [] } = await req.json();

    const openAiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('EXPO_PUBLIC_OPENAI_API_KEY');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Auth check
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    // 2. Single GPT-4o call with two-step reasoning + bilingual output.
    //    Step 1: detect language, resolve original title
    //    Step 2: recall metadata and produce BOTH English and Polish versions
    const metaResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert multilingual librarian. Given an ebook filename, follow these EXACT steps:

STEP 1 — LANGUAGE DETECTION & ORIGINAL TITLE RESOLUTION:
- Detect the language of the title in the filename.
- If the title is NOT in English, determine whether it is:
  (a) A Polish translation of a non-Polish work — resolve it to the ORIGINAL title.
      Example: "W kajdanach" → original title is "Manacled" by SenLinYu (Harry Potter fanfiction)
      Example: "Diuna" → original title is "Dune" by Frank Herbert
  (b) A Polish original work — keep the Polish title as the primary title.
      Example: "Lalka" → "Lalka" by Bolesław Prus
- Also extract the author if present in the filename (e.g. "Manacled_SenLinYu" → SenLinYu).

STEP 2 — BILINGUAL METADATA:
From your knowledge of the resolved book/work, produce:
- English title ("title") and English description ("description")
- Polish title ("title_pl") — the official Polish translation title if one exists, or a direct Polish translation if not
- Polish description ("description_pl") — a natural Polish language summary of the same quality as the English one
- Fanfiction is valid — genre: "Fanfiction - [Fandom]"
- NEVER substitute a different book. Use "low" confidence if unsure.

Output a single JSON object:
{
  "detected_language": "Polish | English | other",
  "title": "Original/English title",
  "title_pl": "Polish translation title (official if it exists)",
  "author": "Full author name(s)",
  "genre": "Primary genre",
  "description": "3-4 sentence English summary",
  "description_pl": "3-4 sentence Polish summary (natural Polish, not word-for-word translation)",
  "moods": ["mood1", "mood2", "mood3"],
  "confidence": "high | medium | low",
  "notes": "Any useful context"
}`
          },
          {
            role: 'user',
            content: `Filename: "${fileName}"\n\nFirst detect language and resolve the original work, then give full bilingual metadata.`
          }
        ],
        response_format: { type: 'json_object' },
      }),
    });

    const metaData = await metaResponse.json();

    if (!metaData.choices?.[0]?.message?.content) {
      throw new Error(`OpenAI metadata call failed: ${JSON.stringify(metaData)}`);
    }

    const metadata = JSON.parse(metaData.choices[0].message.content);

    const title: string        = metadata.title        || fileName;
    const title_pl: string     = metadata.title_pl     || title;
    const author: string       = metadata.author       || 'Unknown';
    const genre: string        = metadata.genre        || 'Unknown';
    const description: string  = metadata.description  || 'No description available.';
    const description_pl: string = metadata.description_pl || description;
    const moods: string[]      = Array.isArray(metadata.moods) ? metadata.moods.slice(0, 5) : [];
    const confidence: string   = metadata.confidence   || 'low';

    console.log(`Processed: "${title}" / "${title_pl}" by ${author} [confidence: ${confidence}]`);

    // 3. Embedding — include both language versions so AI search works in EN and PL
    const embeddingText = [
      `Title: ${title}.`,
      `Polish title: ${title_pl}.`,
      `Author: ${author}.`,
      `Genre: ${genre}.`,
      `Description: ${description}`,
      `Moods: ${moods.join(', ')}.`,
    ].join(' ');

    const embedResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: embeddingText,
        model: 'text-embedding-3-small',
      }),
    });
    const embedData = await embedResponse.json();

    if (!embedData.data?.[0]?.embedding) {
      throw new Error(`Embedding call failed: ${JSON.stringify(embedData)}`);
    }

    const embedding = embedData.data[0].embedding;

    // 4. Upsert to Supabase
    const { data: insertedBook, error: insertError } = await supabaseClient
      .from('books')
      .upsert({
        title,
        title_pl,
        author,
        genre,
        description,
        description_pl,
        moods,
        folder_tags: folderTags,
        drive_file_id: driveFileId,
        embedding,
        user_id: user.id,
      }, { onConflict: 'drive_file_id' })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, book: insertedBook, confidence }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('process-ebook error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
