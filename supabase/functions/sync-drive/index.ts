import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isSupportedBookFile(item: { mimeType?: string; name?: string }): boolean {
  const mime = (item.mimeType || '').toLowerCase();
  const name = (item.name || '').toLowerCase();

  if (mime === 'application/epub+zip') return true;
  if (mime === 'application/pdf') return true;
  if (mime === 'application/x-mobipocket-ebook') return true;

  // Some Drive files are returned as application/octet-stream, so use extension fallback.
  return (
    name.endsWith('.epub') ||
    name.endsWith('.pdf') ||
    name.endsWith('.mobi') ||
    name.endsWith('.azw') ||
    name.endsWith('.azw3')
  );
}

// Recursive function to fetch files from Google Drive
async function fetchFolderRecursive(folderId: string, currentTags: string[], providerToken: string, allFiles: any[] = []) {
  const query = `'${folderId}' in parents and trashed = false`;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,createdTime,owners(emailAddress))`, {
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
      await fetchFolderRecursive(item.id, [...currentTags, item.name.trim()], providerToken, allFiles);
    } else if (isSupportedBookFile(item)) {
      // It's a book
      const ownerEmail = item.owners?.[0]?.emailAddress || null;
      allFiles.push({
        driveFileId: item.id,
        fileName: item.name,
        folderTags: currentTags,
        driveUploadedAt: item.createdTime || null,
        ownerEmail,
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const supabaseAdmin = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : supabaseClient;

    // 1. Get user session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    // 2. Fetch all books and tags recursively from Drive
    const discoveredBooks = await fetchFolderRecursive(sharedFolderId, [], providerToken);

    // 3. Fetch existing books from Supabase to prevent duplicates and detect moved files
    const { data: existingBooks, error: existingBooksError } = await supabaseAdmin
      .from('books')
      .select('id, drive_file_id, folder_tags, user_id');
    if (existingBooksError) throw existingBooksError;

    const existingByDriveId = new Map<string, { id: string; drive_file_id: string; folder_tags: string[] | null; user_id: string }>(
      (existingBooks || []).map((b: any) => [b.drive_file_id, b])
    );
    const existingFileIds = new Set(existingByDriveId.keys());
    const discoveredDriveIds = new Set(discoveredBooks.map((book: any) => book.driveFileId).filter(Boolean));

    const newBooksToProcess = discoveredBooks.filter((b: any) => !existingFileIds.has(b.driveFileId));

    // 4. For new books, look up the owner's user_id from the profiles table by email
    const newBooksWithUserId = await Promise.all(
      newBooksToProcess.map(async (book) => {
        let userId = user.id; // Default to current user if owner not found
        
        if (book.ownerEmail) {
          const { data: ownerProfile } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('email', book.ownerEmail)
            .maybeSingle();
          
          if (ownerProfile?.id) {
            userId = ownerProfile.id;
          }
        }
        
        return { ...book, userId };
      })
    );

    // 5. Remove books that are no longer present in Drive
    const booksToDelete = (existingBooks || []).filter((book: any) => {
      if (!book?.drive_file_id) return false;
      return !discoveredDriveIds.has(book.drive_file_id);
    });

    let deletedBooksCount = 0;
    if (booksToDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('books')
        .delete()
        .in('drive_file_id', booksToDelete.map((book: any) => book.drive_file_id));

      if (deleteError) throw deleteError;
      deletedBooksCount = booksToDelete.length;
    }

    // 6. Update folder tags and user_id for books that already exist
    let movedBooksUpdated = 0;
    for (const discovered of discoveredBooks) {
      const existing = existingByDriveId.get(discovered.driveFileId);
      if (!existing) continue;

      const currentTags = Array.isArray(existing.folder_tags) ? existing.folder_tags : [];
      const nextTags = Array.isArray(discovered.folderTags) ? discovered.folderTags : [];
      const tagsChanged = JSON.stringify(currentTags) !== JSON.stringify(nextTags);

      // Look up the owner's user_id for existing books too
      let nextUserId = existing.user_id;
      if (discovered.ownerEmail) {
        const { data: ownerProfile } = await supabaseClient
          .from('profiles')
          .select('id')
          .eq('email', discovered.ownerEmail)
          .maybeSingle();

        if (ownerProfile?.id) {
          nextUserId = ownerProfile.id;
        }
      }

      const ownerChanged = nextUserId !== existing.user_id;

      if (!tagsChanged && !ownerChanged) continue;

      const updateData: any = {};
      if (tagsChanged) updateData.folder_tags = nextTags;
      if (ownerChanged) updateData.user_id = nextUserId;

      const { error: updateError } = await supabaseAdmin
        .from('books')
        .update(updateData)
        .eq('id', existing.id);

      if (updateError) throw updateError;
      movedBooksUpdated++;
    }

    // For edge functions, processing too many files at once with OpenAI could timeout.
    // We return the list of new books so the client app can send them to process-ebook one-by-one.
    return new Response(JSON.stringify({ 
      success: true, 
      discoveredCount: discoveredBooks.length,
      movedBooksUpdated,
      deletedBooksCount,
      newBooks: newBooksWithUserId
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
