import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.5.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by',
  'i', 'ii', 'iii', 'iv', 'v', 'tom', 'vol', 'part', 'czesc', 'cz', 'book',
  'ebook', 'epub', 'mobi', 'pdf', 'azw3',
]);

function stripExtension(input: string): string {
  return input.replace(/\.[a-zA-Z0-9]{2,5}$/u, '');
}

function normalizeFilenameTitle(input: string): string {
  return stripExtension(input)
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return normalized
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenOverlapScore(reference: string, candidate: string): number {
  const referenceTokens = new Set(tokenize(reference));
  const candidateTokens = new Set(tokenize(candidate));

  if (referenceTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of referenceTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }

  return overlap / referenceTokens.size;
}

function clampConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'low';
}

type DriveFileMeta = {
  id?: string;
  name?: string;
  mimeType?: string;
  description?: string;
  createdTime?: string;
  webViewLink?: string;
  webContentLink?: string;
};

type EpubMeta = {
  title?: string;
  author?: string;
  language?: string;
  description?: string;
  source: 'epub-opf';
};

async function fetchDriveFileMeta(driveFileId: string, providerToken: string): Promise<DriveFileMeta | null> {
  const fields = 'id,name,mimeType,description,createdTime,webViewLink,webContentLink';
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${providerToken}` } }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('Drive metadata fetch failed:', errorText);
    return null;
  }

  return await response.json();
}

async function fetchDriveFileBytes(driveFileId: string, providerToken: string): Promise<Uint8Array | null> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('Drive file download failed:', errorText);
    return null;
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function firstTextValue(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTextValue(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string') return value['#text'].trim() || undefined;
    if (typeof value['__text'] === 'string') return value['__text'].trim() || undefined;
  }
  return undefined;
}

function resolveOpfPath(containerObj: any): string | undefined {
  const rootfiles = containerObj?.container?.rootfiles?.rootfile;
  if (!rootfiles) return undefined;

  const entry = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  return entry?.['@_full-path'];
}

async function extractEpubMetadata(fileBytes: Uint8Array): Promise<EpubMeta | null> {
  const zip = await JSZip.loadAsync(fileBytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    removeNSPrefix: true,
  });

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) return null;

  const containerXml = await containerFile.async('text');
  const containerObj = parser.parse(containerXml);

  let opfPath = resolveOpfPath(containerObj);
  if (!opfPath) {
    const fallbackOpf = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));
    opfPath = fallbackOpf;
  }
  if (!opfPath) return null;

  const opfFile = zip.file(opfPath);
  if (!opfFile) return null;

  const opfXml = await opfFile.async('text');
  const opfObj = parser.parse(opfXml);
  const metadata = opfObj?.package?.metadata;
  if (!metadata) return null;

  const title = firstTextValue(metadata.title);
  const author = firstTextValue(metadata.creator);
  const language = firstTextValue(metadata.language);
  const description = firstTextValue(metadata.description);

  if (!title && !author && !description) return null;

  return {
    title,
    author,
    language,
    description,
    source: 'epub-opf',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      driveFileId,
      fileName,
      folderTags = [],
      driveUploadedAt = null,
      providerToken = null,
    } = await req.json();

    const normalizedFileTitle = normalizeFilenameTitle(fileName);
    const filenameTokens = tokenize(normalizedFileTitle);
    const hasStrongDisambiguation =
      /\bby\b/i.test(fileName) ||
      /\d{4}/.test(fileName) ||
      fileName.includes(' - ') ||
      filenameTokens.length >= 3;
    const isAmbiguousFilename = !hasStrongDisambiguation;

    let driveMeta: DriveFileMeta | null = null;
    let epubMeta: EpubMeta | null = null;

    if (providerToken && driveFileId) {
      driveMeta = await fetchDriveFileMeta(driveFileId, providerToken);
      const isEpub =
        driveMeta?.mimeType === 'application/epub+zip' ||
        fileName.toLowerCase().endsWith('.epub');

      if (isEpub) {
        try {
          const fileBytes = await fetchDriveFileBytes(driveFileId, providerToken);
          if (fileBytes) {
            epubMeta = await extractEpubMetadata(fileBytes);
          }
        } catch (downloadError: any) {
          console.warn('EPUB extraction skipped:', downloadError?.message || String(downloadError));
        }
      }
    }

    const hasAuthoritativeFileMetadata = Boolean(epubMeta?.title || epubMeta?.author || driveMeta?.description);

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
- Title detected ("file_title") - title detected from the filename
- English title ("title") and English description ("description")
- Polish title ("title_pl") — the official Polish translation title if one exists, or a direct Polish translation if not
- Polish description ("description_pl") — a natural Polish language summary of the same quality as the English one
- Fanfiction is valid — genre: "Fanfiction - [Fandom]"
- NEVER substitute a different book. Use "low" confidence if unsure.
- If filename is ambiguous (very short, no author, no year, no series info), DO NOT guess a famous book. Keep the detected filename title and set confidence to "low".
- Prefer preserving the exact filename-derived title over speculative canonicalization.
- If file-level metadata is provided (EPUB OPF / Drive metadata), treat it as authoritative and prioritize it over filename heuristics.

Output a single JSON object:
{
  "file_title": "Title detected from the filename",
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
            content: `Filename: "${fileName}"\nNormalized title from filename: "${normalizedFileTitle}"\nFilename ambiguous: ${isAmbiguousFilename ? 'yes' : 'no'}\n\nDrive metadata: ${JSON.stringify({
              mimeType: driveMeta?.mimeType || null,
              description: driveMeta?.description || null,
            })}\n\nExtracted EPUB metadata: ${JSON.stringify(epubMeta || null)}\n\nFirst detect language and resolve the original work, then give full bilingual metadata. If ambiguous, avoid speculative matches. If file metadata is available, trust it first.`
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

    const modelFileTitle = metadata.file_title || normalizedFileTitle || fileName;
    const modelTitle = metadata.title || modelFileTitle;
    const modelTitlePl = metadata.title_pl || modelTitle;
    const modelAuthor = metadata.author || 'Unknown';
    const modelGenre = metadata.genre || 'Unknown';
    const modelDescription = metadata.description || epubMeta?.description || 'No description available.';
    const modelDescriptionPl = metadata.description_pl || modelDescription;
    const modelMoods: string[] = Array.isArray(metadata.moods) ? metadata.moods.slice(0, 5) : [];
    const modelConfidence = clampConfidence(metadata.confidence);
    let title_alt: string = '';
    const lubimyczytac_url: string = metadata.lubimyczytac_url || '';
    const goodreads_url: string = metadata.goodreads_url || '';
    const sourceNotes = [
      epubMeta ? 'source:epub-opf' : '',
      driveMeta?.mimeType ? `mime:${driveMeta.mimeType}` : '',
    ].filter(Boolean).join(', ');

    const combinedModelTitles = `${modelFileTitle} ${modelTitle} ${modelTitlePl}`;
    const overlapScore = tokenOverlapScore(normalizedFileTitle, combinedModelTitles);
    const shouldUseFallback = !hasAuthoritativeFileMetadata && isAmbiguousFilename && overlapScore < 0.5;

    const file_title: string = shouldUseFallback ? normalizedFileTitle : modelFileTitle;
    const title: string = shouldUseFallback ? normalizedFileTitle : modelTitle;
    const title_pl: string = shouldUseFallback ? normalizedFileTitle : modelTitlePl;
    const author: string = shouldUseFallback ? 'Unknown' : modelAuthor;
    const genre: string = shouldUseFallback ? 'Unknown' : modelGenre;
    const description: string = shouldUseFallback
      ? 'Metadata could not be confidently inferred from filename alone.'
      : modelDescription;
    const description_pl: string = shouldUseFallback
      ? 'Nie udalo sie wiarygodnie ustalic metadanych na podstawie samej nazwy pliku.'
      : modelDescriptionPl;
    const moods: string[] = shouldUseFallback ? [] : modelMoods;
    const confidence: string = shouldUseFallback ? 'low' : modelConfidence;

    if (shouldUseFallback) {
      console.log(`Fallback metadata used for ambiguous filename "${fileName}" (overlap: ${overlapScore.toFixed(2)})`);
    }

    console.log(`Processed: "${title}" / "${title_pl}" by ${author} [confidence: ${confidence}]${sourceNotes ? ` [${sourceNotes}]` : ''}`);

    // 3. Embedding — include both language versions so AI search works in EN and PL
    const embeddingText = [
      `File title: ${file_title}.`,
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

    if (file_title !== title) {
      title_alt = title;
    }

    const embedding = embedData.data[0].embedding;
    const parsedDriveUploadedAt =
      typeof driveUploadedAt === 'string' && !Number.isNaN(Date.parse(driveUploadedAt))
        ? driveUploadedAt
        : null;

    // 4. Upsert to Supabase
    const { data: insertedBook, error: insertError } = await supabaseClient
      .from('books')
      .upsert({
        title: file_title,
        alt_title: title_alt,
        author,
        genre,
        description,
        description_pl,
        moods,
        folder_tags: folderTags,
        drive_file_id: driveFileId,
        ...(parsedDriveUploadedAt ? { drive_uploaded_at: parsedDriveUploadedAt } : {}),
        embedding,
        user_id: user.id
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
