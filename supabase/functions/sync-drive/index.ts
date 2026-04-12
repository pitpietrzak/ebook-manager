import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Recursive function to fetch files from Google Drive
async function fetchFolderRecursive(folderId: string, currentTags: string[], providerToken: string, allFiles: any[] = []) {
  const query = `'${folderId}' in parents and trashed = false`;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`, {
    headers: { Authorization: `Bearer ${providerToken}` }
  });
  
  if (!response.ok) {
     const errorText = await response.text();
     console.error("Drive API Error:", errorText);
     throw new Error("Failed to fetch from Google Drive");
  }

  const data = await response.json();
  const items = data.files || [];

  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // It's a folder, traverse deep
      await fetchFolderRecursive(item.id, [...currentTags, item.name], providerToken, allFiles);
    } else if (item.mimeType === 'application/epub+zip' || item.mimeType === 'application/pdf') {
      // It's a book
      allFiles.push({
        driveFileId: item.id,
        fileName: item.name,
        folderTags: currentTags
      });
    }
  }
  return allFiles;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { providerToken, sharedFolderId } = await req.json();

    if (!providerToken || !sharedFolderId) {
      throw new Error('Missing provider token or shared folder ID');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 1. Get user session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    // 2. Fetch all books and tags recursively from Drive
    const discoveredBooks = await fetchFolderRecursive(sharedFolderId, [], providerToken);

    // 3. Fetch existing books from Supabase to prevent duplicates
    const { data: existingBooks } = await supabaseClient.from('books').select('drive_file_id');
    const existingFileIds = new Set(existingBooks?.map(b => b.drive_file_id) || []);

    const newBooksToProcess = discoveredBooks.filter(b => !existingFileIds.has(b.driveFileId));

    // For edge functions, processing too many files at once with OpenAI could timeout.
    // We return the list of new books so the client app can send them to process-ebook one-by-one.
    return new Response(JSON.stringify({ 
      success: true, 
      discoveredCount: discoveredBooks.length,
      newBooks: newBooksToProcess
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
