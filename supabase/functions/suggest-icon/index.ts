import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SAFE_ICONS = [
  'Book', 'BookOpen', 'Bookmark', 'Library', 'Flame', 'Sword', 'Axe', 'Music', 'Code', 'Terminal', 'Cpu', 'Database',
  'Heart', 'Star', 'Cloud', 'Sun', 'Moon', 'Rocket', 'Coffee', 'Camera', 'Map', 'Phone', 'Briefcase', 'GraduationCap',
  'Palette', 'Globe', 'Zap', 'Shield', 'Gift', 'ShoppingCart', 'Truck', 'Plane', 'Bike', 'Car', 'Anchor', 'Umbrella',
  'Key', 'Lock', 'Bell', 'Mail', 'Send', 'Image', 'Video', 'Mic', 'Volume2', 'Search', 'Settings', 'User', 'Users',
  'Home', 'Activity', 'Wind', 'Droplets', 'Compass', 'Clock', 'Target', 'Trophy', 'LifeBuoy', 'Stethoscope',
  'Ghost', 'Egg', 'Crown', 'Diamond', 'FlaskConical', 'Dna', 'Atom', 'Leaf', 'PawPrint', 'Trees', 'Mountains', 'Waves'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name } = await req.json();
    if (!name) throw new Error('Name is required');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role to write
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Check if icon already exists
    const { data: existing } = await supabaseClient
      .from('collection_icons')
      .select('icon_name')
      .eq('name', name)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ icon_name: existing.icon_name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 2. Suggest using OpenAI
    const openAiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('EXPO_PUBLIC_OPENAI_API_KEY');
    
    const prompt = `You are a UI designer. Pick the most suitable Lucide icon name for a folder category named "${name}".
    Choose from a set of high-quality icons including: Book, Wand, Sword, Flame, Scroll, Rocket, Heart, Code, Ghost, Crown, etc.
    Respond with ONLY the icon name (one word), no punctuation.
    Category names can be in Polish or English.`;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
      }),
    });

    const aiData = await aiResponse.json();
    let suggestedIcon = aiData.choices?.[0]?.message?.content?.trim();

    // Sanitize suggestedIcon - remove any accidental quotes or extra text
    suggestedIcon = suggestedIcon.replace(/[^a-zA-Z]/g, '');

    // Default if invalid
    if (!SAFE_ICONS.includes(suggestedIcon)) {
      suggestedIcon = 'Layers';
    }

    // 3. Store in DB
    const { error: insertError } = await supabaseClient
      .from('collection_icons')
      .upsert({ name, icon_name: suggestedIcon });

    if (insertError) console.error('Error storing icon:', insertError);

    return new Response(JSON.stringify({ icon_name: suggestedIcon }), {
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
