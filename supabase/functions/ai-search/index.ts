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
    const { query } = await req.json();
    const trimmedQuery = String(query || '').trim();

    if (!trimmedQuery) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const runFallbackSearch = async () => {
      const safeQuery = trimmedQuery.replace(/[%(),]/g, ' ').trim();
      const { data, error } = await supabaseClient
        .from('books')
        .select('id, title, author, genre, description, moods, folder_tags')
        .or(`title.ilike.%${safeQuery}%,author.ilike.%${safeQuery}%,genre.ilike.%${safeQuery}%,description.ilike.%${safeQuery}%`)
        .limit(8);

      if (error) throw error;
      return data || [];
    };

    const openAiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('EXPO_PUBLIC_OPENAI_API_KEY');
    if (!openAiKey) {
      const fallbackBooks = await runFallbackSearch();
      return new Response(JSON.stringify(fallbackBooks), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const openAiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: trimmedQuery,
        model: 'text-embedding-3-small',
      }),
    });

    const embeddingData = await openAiResponse.json();
    if (!openAiResponse.ok || !embeddingData?.data?.[0]?.embedding) {
      const fallbackBooks = await runFallbackSearch();
      return new Response(JSON.stringify(fallbackBooks), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const queryEmbedding = embeddingData.data[0].embedding;
    const { data: matches, error } = await supabaseClient.rpc('match_books', {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: 8,
    });

    if (error) {
      const fallbackBooks = await runFallbackSearch();
      return new Response(JSON.stringify(fallbackBooks), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (!matches || matches.length === 0) {
      const fallbackBooks = await runFallbackSearch();
      return new Response(JSON.stringify(fallbackBooks), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(JSON.stringify(matches), {
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
