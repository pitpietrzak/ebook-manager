import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.5.0';
import * as mobiParser from 'https://esm.sh/@lingo-reader/mobi-parser@0.4.6?bundle';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by',
  'i', 'ii', 'iii', 'iv', 'v', 'tom', 'vol', 'part', 'czesc', 'cz', 'book',
  'ebook', 'epub', 'mobi', 'pdf', 'azw3',
]);

const LOW_QUALITY_BOOK_TERMS = [
  'summary', 'study guide', 'analysis', 'workbook', 'companion', 'sparknotes',
  'cliffsnotes', 'litchart', 'bookrags', 'supersummary', 'key takeaways',
  'lesson plan', 'quiz', 'discussion questions', 'notes', 'abstract',
  'opracowanie', 'streszczenie', 'analiza',
];

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

function sanitizeBookUrl(value: unknown, allowedHost: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';

  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith(allowedHost)) return '';
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function decodeDuckDuckGoRedirect(href: string): string {
  try {
    if (href.startsWith('/l/?')) {
      const parsed = new URL(`https://duckduckgo.com${href}`);
      const uddg = parsed.searchParams.get('uddg');
      return uddg ? decodeURIComponent(uddg) : '';
    }
    return href;
  } catch {
    return '';
  }
}

function extractDomainLinksFromHtml(html: string, allowedHost: string): string[] {
  const matches = html.matchAll(/href="([^"]+)"/g);
  const unique = new Set<string>();

  for (const match of matches) {
    const rawHref = match[1] || '';
    const decoded = decodeDuckDuckGoRedirect(rawHref);
    const candidate = decoded || rawHref;
    const clean = sanitizeBookUrl(candidate, allowedHost);
    if (clean) unique.add(clean);
  }

  return Array.from(unique);
}

function scoreUrlCandidate(url: string, title: string, author: string): number {
  const needle = `${title} ${author}`;
  const hay = decodeURIComponent(url)
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[\/_\-]+/g, ' ');
  return tokenOverlapScore(needle, hay);
}

function containsLowQualityBookSignals(text: string): boolean {
  const normalized = stripDiacritics(text || '').toLowerCase();
  return LOW_QUALITY_BOOK_TERMS.some((term) => normalized.includes(term));
}

function qualityPenaltyFromUrl(url: string): number {
  return containsLowQualityBookSignals(decodeURIComponent(url)) ? 2 : 0;
}

function normalizeAuthorName(rawAuthor: string): string {
  const source = (rawAuthor || '').trim();
  if (!source) return '';

  const candidates = source
    .split(/[,;|/&]|\band\b|\boraz\b/gi)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\([^)]*\)/g, '').trim())
    .map((part) => part.replace(/\b(uploaded by|uploader|username|user|nick|profil|konto)\b/gi, '').trim())
    .filter(Boolean)
    .filter((part) => !/\d/.test(part));

  const best = candidates.find((part) => {
    const tokens = tokenize(part);
    return tokens.length >= 1 && tokens.length <= 4;
  });

  return best || source;
}

function resolveBestAuthor(epubAuthor: string | undefined, modelAuthor: string | undefined): string {
  const epub = normalizeAuthorName(epubAuthor || '');
  if (epub) return epub;

  const model = normalizeAuthorName(modelAuthor || '');
  if (model) return model;

  return 'Unknown';
}

function scoreAuthorPresenceInText(text: string, expectedAuthor: string): number {
  const authorTokens = tokenize(expectedAuthor);
  if (authorTokens.length === 0) return 0;

  const normalizedText = stripDiacritics(text).toLowerCase();
  let matched = 0;
  for (const token of authorTokens) {
    if (normalizedText.includes(token)) matched += 1;
  }

  return matched / authorTokens.length;
}

function scoreTitlePresenceInText(text: string, expectedTitle: string): number {
  const titleTokens = tokenize(expectedTitle);
  if (titleTokens.length === 0) return 0;

  const normalizedText = stripDiacritics(text).toLowerCase();
  let matched = 0;
  for (const token of titleTokens) {
    if (normalizedText.includes(token)) matched += 1;
  }

  return matched / titleTokens.length;
}

async function scoreAuthorOnPage(url: string, expectedAuthor: string): Promise<number> {
  if (!expectedAuthor.trim()) return 0;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) return 0;

    const html = await response.text();
    const sample = html.slice(0, 50000).replace(/<[^>]+>/g, ' ');
    return scoreAuthorPresenceInText(sample, expectedAuthor);
  } catch {
    return 0;
  }
}

function rankCandidates(urls: string[], title: string, author: string): string {
  if (urls.length === 0) return '';

  const ranked = urls
    .map((url) => {
      const baseScore = scoreUrlCandidate(url, title, author);
      const score = baseScore - qualityPenaltyFromUrl(url);
      return { url, score, baseScore };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked
    .slice(0, 3)
    .map((entry) => `${entry.score.toFixed(3)}(base:${entry.baseScore.toFixed(3)}):${entry.url}`);
  console.log(`[URL lookup] ranked candidates: ${top.join(' | ')}`);

  if (!ranked[0]) return '';
  if (ranked[0].score >= 0.8) return ranked[0].url;
  return '';
}

async function rankCandidatesWithAuthorVerification(urls: string[], title: string, author: string): Promise<string> {
  if (urls.length === 0) return '';

  const baseRanked = urls
    .map((url) => ({ url, baseScore: scoreUrlCandidate(url, title, author) }))
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 5);

  const scored = [] as Array<{
    url: string;
    score: number;
    baseScore: number;
    authorScore: number;
    titleScore: number;
    qualityPenalty: number;
  }>;
  for (const item of baseRanked) {
    let authorScore = 0;
    let titleScore = 0;
    let qualityPenalty = qualityPenaltyFromUrl(item.url);

    try {
      const response = await fetch(item.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html',
        },
      });

      if (response.ok) {
        const html = await response.text();
        const sample = html.slice(0, 60000).replace(/<[^>]+>/g, ' ');
        authorScore = scoreAuthorPresenceInText(sample, author);
        titleScore = scoreTitlePresenceInText(sample, title);
        if (containsLowQualityBookSignals(sample.slice(0, 12000))) {
          qualityPenalty += 2;
        }
      }
    } catch {
      // keep scores at 0 if fetch fails
    }

    const score = item.baseScore + (authorScore * 2) + titleScore - qualityPenalty;
    scored.push({ url: item.url, score, baseScore: item.baseScore, authorScore, titleScore, qualityPenalty });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored
    .slice(0, 3)
    .map((entry) => `${entry.score.toFixed(3)}(base:${entry.baseScore.toFixed(3)},author:${entry.authorScore.toFixed(3)},title:${entry.titleScore.toFixed(3)},penalty:${entry.qualityPenalty.toFixed(1)}):${entry.url}`);
  console.log(`[URL lookup] verified candidates: ${top.join(' | ')}`);

  const best = scored[0];
  if (!best) return '';

  // Strict precision gate: avoid wrong links if confidence is weak.
  if (best.score < 1.0) return '';
  if (author.trim() && best.authorScore < 0.4) return '';
  return best.url;
}

function rankCandidatesWithContextScores(
  candidates: Array<{ url: string; context: string }>,
  title: string,
  author: string,
): string {
  if (candidates.length === 0) return '';

  const scored = candidates.map(({ url, context }) => {
    const baseScore = scoreUrlCandidate(url, title, author);
    const authorScore = scoreAuthorPresenceInText(context, author);
    const titleScore = scoreAuthorPresenceInText(context, title);
    const qualityPenalty = qualityPenaltyFromUrl(url) + (containsLowQualityBookSignals(context) ? 2 : 0);
    const score = baseScore + (authorScore * 2) + titleScore - qualityPenalty;
    return { url, score, baseScore, authorScore, titleScore, qualityPenalty };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored
    .slice(0, 3)
    .map((e) => `${e.score.toFixed(3)}(base:${e.baseScore.toFixed(3)},auth:${e.authorScore.toFixed(3)},title:${e.titleScore.toFixed(3)},penalty:${e.qualityPenalty.toFixed(1)}):${e.url}`);
  console.log(`[URL lookup] context-ranked candidates: ${top.join(' | ')}`);

  const best = scored[0];
  if (!best) return '';
  if (best.score < 1.0) return '';
  if (author.trim() && best.authorScore < 0.4) return '';
  return best.url;
}

function extractUrlsByRegex(html: string, regex: RegExp, allowedHost: string): string[] {
  const unique = new Set<string>();
  for (const match of html.matchAll(regex)) {
    const href = (match[1] || '').replace(/&amp;/g, '&');
    let absolute = href;

    if (href.startsWith('/')) {
      absolute = `https://${allowedHost}${href}`;
    }

    const clean = sanitizeBookUrl(absolute, allowedHost);
    if (clean) unique.add(clean);
  }
  return Array.from(unique);
}

function extractCandidatesWithContext(
  html: string,
  regex: RegExp,
  allowedHost: string,
): Array<{ url: string; context: string }> {
  const results: Array<{ url: string; context: string }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(regex)) {
    const href = (match[1] || '').replace(/&amp;/g, '&');
    const absolute = href.startsWith('/') ? `https://${allowedHost}${href}` : href;
    const clean = sanitizeBookUrl(absolute, allowedHost);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);

    // Extract a window of text around this link to check for author name
    const start = Math.max(0, match.index! - 600);
    const end = Math.min(html.length, match.index! + 600);
    const context = html.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    results.push({ url: clean, context });
  }

  return results;
}

async function findBookUrlOnLubimyCzytac(title: string, author: string): Promise<string> {
  const safeTitle = (title || '').trim();
  const safeAuthor = (author || '').trim();
  if (!safeTitle) return '';

  const asciiTitle = stripDiacritics(safeTitle);
  const asciiAuthor = stripDiacritics(safeAuthor);

  // Queries ordered: title+author first, then author-only (finds books even when title search misses),
  // then ASCII fallbacks
  const queries = [
    `${safeTitle} ${safeAuthor}`.trim(),
    safeAuthor,
    safeTitle,
    `${asciiTitle} ${asciiAuthor}`.trim(),
    asciiAuthor ? asciiAuthor : '',
    asciiTitle,
  ].filter(Boolean);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const uniqueQueries = queries.filter((q) => {
    if (seen.has(q)) return false;
    seen.add(q);
    return true;
  });

  const allCandidates = new Map<string, string>(); // url → best context

  for (const q of uniqueQueries) {
    const url = `https://lubimyczytac.pl/szukaj/ksiazki?phrase=${encodeURIComponent(q)}`;
    console.log(`[URL lookup] lubimyczytac query: ${q}`);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      });
      console.log(`[URL lookup] lubimyczytac status: ${response.status}`);
      if (!response.ok) continue;

      const html = await response.text();
      const candidates = extractCandidatesWithContext(
        html,
        /href=["'](\/ksiazka\/[^"']+)["']/g,
        'lubimyczytac.pl'
      );
      console.log(`[URL lookup] lubimyczytac extracted: ${candidates.length}`);

      for (const { url: candidateUrl, context } of candidates) {
        if (!allCandidates.has(candidateUrl)) {
          allCandidates.set(candidateUrl, context);
        }
      }
    } catch (error: any) {
      console.warn('[URL lookup] lubimyczytac failed:', error?.message || String(error));
    }
  }

  if (allCandidates.size === 0) return '';

  const merged = Array.from(allCandidates.entries()).map(([u, ctx]) => ({ url: u, context: ctx }));
  const selected = rankCandidatesWithContextScores(merged, safeTitle, safeAuthor);
  console.log(`[URL lookup] lubimyczytac selected: ${selected || '(empty)'}`);
  return selected;
}

async function findBookUrlOnGoodreads(title: string, author: string): Promise<string> {
  const safeTitle = (title || '').trim();
  const safeAuthor = (author || '').trim();
  if (!safeTitle) return '';

  const asciiTitle = stripDiacritics(safeTitle);
  const asciiAuthor = stripDiacritics(safeAuthor);
  const queries = [
    `${safeTitle} ${safeAuthor}`.trim(),
    safeTitle,
    `${asciiTitle} ${asciiAuthor}`.trim(),
    asciiTitle,
  ];

  for (const q of queries) {
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
    console.log(`[URL lookup] goodreads direct query: ${q}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html',
        },
      });
      console.log(`[URL lookup] goodreads direct status: ${response.status}`);
      if (!response.ok) continue;

      const html = await response.text();
      const urls = extractUrlsByRegex(
        html,
        /href=["']((?:https?:\/\/(?:www\.)?goodreads\.com)?\/book\/show\/[^"']+)["']/g,
        'goodreads.com'
      );
      console.log(`[URL lookup] goodreads direct extracted: ${urls.length}`);
      if (urls.length === 0) continue;

      const selected = await rankCandidatesWithAuthorVerification(urls, safeTitle, safeAuthor);
      console.log(`[URL lookup] goodreads direct selected: ${selected || '(empty)'}`);
      if (selected) return selected;
    } catch (error: any) {
      console.warn('[URL lookup] goodreads direct failed:', error?.message || String(error));
    }
  }

  return '';
}

async function findBookUrlWithDuckDuckGo(allowedHost: string, title: string, author: string): Promise<string> {
  const safeTitle = (title || '').trim();
  const safeAuthor = (author || '').trim();
  if (!safeTitle) return '';

  const queries = [
    `site:${allowedHost} "${safeTitle}" "${safeAuthor}"`,
    `site:${allowedHost} "${safeTitle}"`,
  ];

  const endpoints = [
    'https://duckduckgo.com/html/?q=',
    'https://lite.duckduckgo.com/lite/?q=',
  ];

  for (const query of queries) {
    console.log(`[URL lookup] ${allowedHost} query: ${query}`);

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${endpoint}${encodeURIComponent(query)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html',
          },
        });

        console.log(`[URL lookup] ${allowedHost} endpoint: ${endpoint} status: ${response.status}`);
        if (!response.ok) continue;

        const html = await response.text();
        const links = extractDomainLinksFromHtml(html, allowedHost);
        console.log(`[URL lookup] ${allowedHost} extracted links: ${links.length}`);

        if (links.length === 0) {
          console.log(`[URL lookup] ${allowedHost} no links in response snippet: ${html.slice(0, 200).replace(/\s+/g, ' ')}`);
          continue;
        }

        const selected = rankCandidates(links, safeTitle, safeAuthor);
        console.log(`[URL lookup] ${allowedHost} selected candidate: ${selected || '(empty)'}`);
        if (selected) return selected;
      } catch (error: any) {
        console.warn(`[URL lookup] ${allowedHost} endpoint failed: ${endpoint}`, error?.message || String(error));
      }
    }
  }

  console.log(`[URL lookup] ${allowedHost} no candidate found for title="${safeTitle}" author="${safeAuthor}"`);
  return '';
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

type BookMeta = {
  title?: string;
  author?: string;
  language?: string;
  description?: string;
  source: 'epub-opf' | 'mobi-metadata' | 'kf8-metadata';
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

async function extractEpubMetadata(fileBytes: Uint8Array): Promise<BookMeta | null> {
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

function extractAuthorString(authorValue: unknown): string | undefined {
  if (typeof authorValue === 'string') return authorValue.trim() || undefined;
  if (Array.isArray(authorValue)) {
    const parts = authorValue
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean);
    return parts.join(', ') || undefined;
  }
  return undefined;
}

async function extractMobiMetadata(fileBytes: Uint8Array, fileName: string): Promise<BookMeta | null> {
  try {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.azw3')) {
      const kf8 = await mobiParser.initKf8File(fileBytes);
      const metadata = kf8.getMetadata();
      const title = metadata.title?.trim();
      const author = extractAuthorString(metadata.author);
      const language = metadata.language?.trim();
      const description = metadata.description?.trim();
      kf8.destroy();

      if (!title && !author && !description) return null;

      return {
        title,
        author,
        language,
        description,
        source: 'kf8-metadata',
      };
    }

    const mobi = await mobiParser.initMobiFile(fileBytes);
    const metadata = mobi.getMetadata();
    const title = metadata.title?.trim();
    const author = extractAuthorString(metadata.author);
    const language = metadata.language?.trim();
    const description = metadata.description?.trim();
    mobi.destroy();

    if (!title && !author && !description) return null;

    return {
      title,
      author,
      language,
      description,
      source: 'mobi-metadata',
    };
  } catch (error: any) {
    console.warn('MOBI/KF8 extraction skipped:', error?.message || String(error));
    return null;
  }
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
    let fileMeta: BookMeta | null = null;

    if (providerToken && driveFileId) {
      driveMeta = await fetchDriveFileMeta(driveFileId, providerToken);
      const isEpub =
        driveMeta?.mimeType === 'application/epub+zip' ||
        fileName.toLowerCase().endsWith('.epub');
      const isMobi =
        driveMeta?.mimeType === 'application/x-mobipocket-ebook' ||
        fileName.toLowerCase().endsWith('.mobi');
      const isKf8 =
        fileName.toLowerCase().endsWith('.azw3');

      if (isEpub || isMobi || isKf8) {
        try {
          const fileBytes = await fetchDriveFileBytes(driveFileId, providerToken);
          if (fileBytes) {
            if (isEpub) {
              fileMeta = await extractEpubMetadata(fileBytes);
            } else {
              fileMeta = await extractMobiMetadata(fileBytes, fileName);
            }
          }
        } catch (downloadError: any) {
          console.warn('Book metadata extraction skipped:', downloadError?.message || String(downloadError));
        }
      }
    }

    const hasAuthoritativeFileMetadata = Boolean(fileMeta?.title || fileMeta?.author || driveMeta?.description);

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
- Ignore uploader/user nicknames or account names in filenames/metadata (e.g. "VeraVerto", "uploaded by ..."). Use only real author names.

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
- Never return study guides, summaries, analyses, workbooks, or companion notes as the main book.

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
  "lubimyczytac_url": "Full https://lubimyczytac.pl/... URL or empty string",
  "goodreads_url": "Full https://www.goodreads.com/... URL or empty string",
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
            })}\n\nExtracted file metadata: ${JSON.stringify(fileMeta || null)}\n\nFirst detect language and resolve the original work, then give full bilingual metadata. If ambiguous, avoid speculative matches. If file metadata is available, trust it first.`
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

    const modelFileTitle = (fileMeta?.title || metadata.file_title || normalizedFileTitle || fileName).trim();
    const modelTitle = metadata.title || modelFileTitle;
    const modelTitlePl = metadata.title_pl || modelTitle;
    const modelAuthor = resolveBestAuthor(fileMeta?.author, metadata.author);
    const modelGenre = metadata.genre || 'Unknown';
    const modelDescription = metadata.description || fileMeta?.description || 'No description available.';
    const modelDescriptionPl = metadata.description_pl || modelDescription;
    const modelMoods: string[] = Array.isArray(metadata.moods) ? metadata.moods.slice(0, 5) : [];
    const modelConfidence = clampConfidence(metadata.confidence);
    let title_alt: string = '';
    let lubimyczytac_url: string = sanitizeBookUrl(metadata.lubimyczytac_url, 'lubimyczytac.pl');
    let goodreads_url: string = sanitizeBookUrl(metadata.goodreads_url, 'goodreads.com');
    console.log(`[URL lookup] model lubimyczytac_url: ${metadata.lubimyczytac_url || '(empty)'}`);
    console.log(`[URL lookup] model goodreads_url: ${metadata.goodreads_url || '(empty)'}`);

    if (!lubimyczytac_url) {
      lubimyczytac_url = await findBookUrlOnLubimyCzytac(modelTitle, modelAuthor);
    }

    if (!lubimyczytac_url) {
      lubimyczytac_url = await findBookUrlWithDuckDuckGo('lubimyczytac.pl', modelTitle, modelAuthor);
    }

    if (!goodreads_url) {
      goodreads_url = await findBookUrlOnGoodreads(modelTitle, modelAuthor);
    }

    if (!goodreads_url) {
      goodreads_url = await findBookUrlWithDuckDuckGo('goodreads.com', modelTitle, modelAuthor);
    }

    console.log(`[URL lookup] final lubimyczytac_url: ${lubimyczytac_url || '(empty)'}`);
    console.log(`[URL lookup] final goodreads_url: ${goodreads_url || '(empty)'}`);
    const sourceNotes = [
      fileMeta ? `source:${fileMeta.source}` : '',
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
      `LubimyCzytac: ${lubimyczytac_url || 'none'}.`,
      `Goodreads: ${goodreads_url || 'none'}.`,
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
        lubimyczytac_url,
        goodreads_url,
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
