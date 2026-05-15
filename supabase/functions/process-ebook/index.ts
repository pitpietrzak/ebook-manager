import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.5.0';
import * as mobiParser from 'https://esm.sh/@lingo-reader/mobi-parser@0.4.6?bundle';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Realistic browser headers used for all HTML scraping requests.
// Bare 'Mozilla/5.0' UAs without Accept-Language/Encoding trigger bot challenges
// on Goodreads and Lubimyczytac, causing correct pages to return no book content.
const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
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

const ISBN_URL_OVERRIDES: Record<string, { goodreads_url?: string; lubimyczytac_url?: string }> = {
  // Curated high-confidence overrides for editions that repeatedly fail automated lookup.
  '9788324047185': {
    goodreads_url: 'https://www.goodreads.com/book/show/43905484-mindhunter-tajemnice-elitarnej-jednostki-fbi',
    lubimyczytac_url: 'https://lubimyczytac.pl/ksiazka/4802406/mindhunter-tajemnice-elitarnej-jednostki-fbi-zajmujacej-sie-sciganiem-seryjnych-przestepcow',
  },
  '9788383305554': {
    goodreads_url: 'https://www.goodreads.com/book/show/220414631-ufo-rz-d-usa-cia-i-pentagon-nasa-i-seti-archiwalne-odtajnione-dokum',
    lubimyczytac_url: 'https://lubimyczytac.pl/ksiazka/5163183/ufo-rzad-usa-cia-i-pentagon-nasa-i-seti-archiwalne-odtajnione-dokumenty-historia-i-terazniejszosc',
  },
};

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

function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/i.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += (10 - i) * Number(isbn[i]);
  }

  const check = isbn[9].toUpperCase() === 'X' ? 10 : Number(isbn[9]);
  sum += check;
  return sum % 11 === 0;
}

function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }

  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

function normalizeIsbnCandidate(rawValue: string): string | null {
  const candidate = rawValue.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (candidate.length === 10 && isValidIsbn10(candidate)) return candidate;
  if (candidate.length === 13 && isValidIsbn13(candidate)) return candidate;
  return null;
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectTextValues(item));
  }

  return [];
}

function extractIsbnsFromText(text: string): string[] {
  if (!text) return [];

  const unique = new Set<string>();
  const matches = text.matchAll(/(?:ISBN(?:-1[03])?[:\s]*)?((?:97[89][0-9\-\s]{10,20}[0-9])|(?:[0-9][0-9\-\s]{8,18}[0-9Xx]))/gi);

  for (const match of matches) {
    const normalized = normalizeIsbnCandidate(match[1] || '');
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique);
}

function extractIsbnsFromValues(values: string[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    for (const isbn of extractIsbnsFromText(value)) {
      unique.add(isbn);
    }
  }

  return Array.from(unique);
}

type IsbnOccurrence = {
  isbn: string;
  label: string;
};

function extractIsbnOccurrencesFromText(text: string): IsbnOccurrence[] {
  if (!text) return [];

  const occurrences: IsbnOccurrence[] = [];
  const matches = text.matchAll(/ISBN(?:[-\s]*(epub|mobi|azw3|print|paperback|hardcover))?[:\s]*((?:97[89][0-9\-\s]{10,20}[0-9])|(?:[0-9][0-9\-\s]{8,18}[0-9Xx]))/gi);

  for (const match of matches) {
    const normalized = normalizeIsbnCandidate(match[2] || '');
    if (!normalized) continue;

    occurrences.push({
      isbn: normalized,
      label: (match[1] || '').toLowerCase(),
    });
  }

  return occurrences;
}

function rankIsbnOccurrences(occurrences: IsbnOccurrence[], preferredFormat: 'epub' | 'mobi'): string[] {
  const unique = new Map<string, { isbn: string; score: number; order: number }>();

  for (let index = 0; index < occurrences.length; index += 1) {
    const occurrence = occurrences[index];
    let score = 1;

    if (preferredFormat === 'epub') {
      if (occurrence.label.includes('epub')) score = 3;
      else if (occurrence.label.includes('mobi')) score = 2;
    } else {
      if (occurrence.label.includes('mobi')) score = 3;
      else if (occurrence.label.includes('epub')) score = 2;
    }

    const existing = unique.get(occurrence.isbn);
    if (!existing || score > existing.score || (score === existing.score && index < existing.order)) {
      unique.set(occurrence.isbn, { isbn: occurrence.isbn, score, order: index });
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.isbn);
}

type IsbnResolvedMeta = {
  isbn: string;
  title?: string;
  author?: string;
  description?: string;
  language?: string;
};

type IsbnAiResolvedMeta = {
  title?: string;
  title_pl?: string;
  author?: string;
  goodreads_url?: string;
  lubimyczytac_url?: string;
};

async function resolveBookByIsbn(isbns: string[]): Promise<IsbnResolvedMeta | null> {
  for (const isbn of isbns) {
    try {
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const volume = data?.items?.[0]?.volumeInfo;
      if (!volume?.title) continue;

      return {
        isbn,
        title: typeof volume.title === 'string' ? volume.title.trim() : undefined,
        author: Array.isArray(volume.authors)
          ? volume.authors.filter((item: unknown) => typeof item === 'string' && item.trim()).join(', ')
          : undefined,
        description: typeof volume.description === 'string' ? volume.description.trim() : undefined,
        language: typeof volume.language === 'string' ? volume.language.trim() : undefined,
      };
    } catch (error: any) {
      console.warn(`[ISBN lookup] google books failed for ${isbn}:`, error?.message || String(error));
    }
  }

  return null;
}

function sanitizeResolvedBookPageUrl(value: unknown, host: 'goodreads.com' | 'lubimyczytac.pl'): string {
  const clean = sanitizeBookUrl(value, host);
  if (!clean) return '';

  try {
    const parsed = new URL(clean);
    const path = parsed.pathname.toLowerCase();

    if (host === 'lubimyczytac.pl') {
      if (path.startsWith('/ksiazka/dodaj') || path.startsWith('/dodaj') || path.startsWith('/szukaj')) return '';
      if (!path.startsWith('/ksiazka/')) return '';
    }

    if (host === 'goodreads.com') {
      if (path.startsWith('/search')) return '';
      if (!path.startsWith('/book/show/')) return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

async function resolveBookByIsbnWithAi(
  openAiKey: string,
  isbns: string[],
  fallbackTitle: string,
  fallbackAuthor: string,
): Promise<IsbnAiResolvedMeta | null> {
  if (!openAiKey || isbns.length === 0) return null;

  try {
    const primaryIsbn = isbns[0];
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${openAiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5.4-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a bibliographic metadata resolver.

Identify the exact book from ISBN and title/author hints.

Return JSON only with exactly these keys:
{
  "title": "",
  "title_pl": "",
  "author": "",
  "goodreads_url": "",
  "lubimyczytac_url": ""
}

Rules:
- "title" = original canonical title (usually the first published title, typically in English).
- "title_pl" = Polish edition title when available; otherwise empty string.
- "author" = primary author name.
- goodreads_url must be EXACTLY:
  https://www.goodreads.com/book/show/<numeric_id>
- lubimyczytac_url must be EXACTLY:
  https://lubimyczytac.pl/ksiazka/<numeric_id>/<slug>
- Remove all query parameters, fragments, and tracking codes.
- Goodreads URLs MUST NOT contain slugs after the numeric ID.
- Never return search, author, add, edit, or profile URLs.
- If you are not highly confident that a URL is correct, return an empty string.
- Do not guess.
- Output valid JSON only, with no markdown or explanation.`
      },
      {
        role: "user",
        content: `ISBN: ${primaryIsbn}
Other ISBN candidates: ${JSON.stringify(isbns)}
Title hint: "${fallbackTitle}"
Author hint: "${fallbackAuthor}"`
      }
    ],
    response_format: { type: "json_object" }
  })
});
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    return {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
      title_pl: typeof parsed.title_pl === 'string' ? parsed.title_pl.trim() : undefined,
      author: typeof parsed.author === 'string' ? parsed.author.trim() : undefined,
      goodreads_url: sanitizeResolvedBookPageUrl(parsed.goodreads_url, 'goodreads.com'),
      lubimyczytac_url: sanitizeResolvedBookPageUrl(parsed.lubimyczytac_url, 'lubimyczytac.pl'),
    };
  } catch (error: any) {
    console.warn('[ISBN AI lookup] failed:', error?.message || String(error));
    return null;
  }
}

function cleanModelUrlOutput(content: string): string {
  if (!content) return '';

  const trimmed = content.trim();
  const unquoted = trimmed.replace(/^['"`]+|['"`]+$/g, '').trim();
  const urlMatch = unquoted.match(/https?:\/\/[^\s"'`<>]+/i);
  return (urlMatch?.[0] || unquoted).trim();
}

async function resolveBookPageUrlWithAi(
  openAiKey: string,
  host: 'goodreads.com' | 'lubimyczytac.pl',
  title: string,
  titlePl: string,
  author: string,
  isbns: string[],
): Promise<string> {
  if (!openAiKey) return '';

  const systemPrompt = host === 'goodreads.com'
    ? `You are a Goodreads URL resolver.

Return only one thing:
- a single full URL to the exact Goodreads book page
- or an empty string if unsure

Rules:
- Only valid format: https://www.goodreads.com/book/show/<numeric_id>
- Never return search/add/author/profile URLs.
- No markdown, no explanations, no extra text.`
    : `You are a LubimyCzytac URL resolver.

Return only one thing:
- a single full URL to the exact LubimyCzytac book page
- or an empty string if unsure

Rules:
- Only valid format: https://lubimyczytac.pl/ksiazka/<numeric_id>/<slug>
- Never return search/add/author/profile URLs.
- No markdown, no explanations, no extra text.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Title: ${title}\nPolish title: ${titlePl}\nAuthor: ${author}\nISBNs: ${JSON.stringify(isbns)}`,
          },
        ],
      }),
    });

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const rawUrl = cleanModelUrlOutput(content);
    return sanitizeResolvedBookPageUrl(rawUrl, host);
  } catch (error: any) {
    console.warn(`[URL AI lookup] ${host} failed:`, error?.message || String(error));
    return '';
  }
}

async function resolveHybridBookUrl(options: {
  host: 'goodreads.com' | 'lubimyczytac.pl';
  openAiKey: string;
  title: string;
  titlePl: string;
  author: string;
  isbns: string[];
  isbnAiUrl?: string;
}): Promise<string> {
  const { host, openAiKey, title, titlePl, author, isbns, isbnAiUrl } = options;

  const candidates: Array<{ url: string; source: string }> = [];

  const addCandidate = (value: string, source: string) => {
    const clean = sanitizeResolvedBookPageUrl(value, host);
    if (!clean) return;
    if (!candidates.some((entry) => entry.url === clean)) {
      candidates.push({ url: clean, source });
    }
  };

  if (host === 'goodreads.com') {
    const scraped = await findBookUrlOnGoodreads(title, author, isbns);
    addCandidate(scraped, 'scraper');

    addCandidate(isbnAiUrl || '', 'isbn-ai');
    const titleAiUrl = await resolveBookPageUrlWithAi(openAiKey, host, title, titlePl, author, isbns);
    addCandidate(titleAiUrl, 'title-ai');
  } else {
    addCandidate(isbnAiUrl || '', 'isbn-ai');
    const titleAiUrl = await resolveBookPageUrlWithAi(openAiKey, host, title, titlePl, author, isbns);
    addCandidate(titleAiUrl, 'title-ai');

    const scraped = await findBookUrlOnLubimyCzytac(titlePl || title, author, isbns);
    addCandidate(scraped, 'scraper');
  }

  if (candidates.length === 0) {
    console.log(`[URL consensus] ${host}: no candidates`);
    return '';
  }

  console.log(`[URL consensus] ${host}: candidates -> ${candidates.map((entry) => `${entry.source}:${entry.url}`).join(' | ')}`);

  for (const candidate of candidates) {
    const verified = await verifyBookUrl(candidate.url, host, host === 'lubimyczytac.pl' ? (titlePl || title) : title, author);
    if (verified) {
      console.log(`[URL consensus] ${host}: accepted ${candidate.source}:${verified}`);
      return verified;
    }
    console.log(`[URL consensus] ${host}: rejected ${candidate.source}:${candidate.url}`);
  }

  console.log(`[URL consensus] ${host}: no verified candidate`);
  return '';
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

async function verifyBookUrl(url: string, allowedHost: string, title: string, author: string): Promise<string> {
  const clean = sanitizeBookUrl(url, allowedHost);
  if (!clean || !title.trim()) return '';

  try {
    const response = await fetch(clean, { headers: SCRAPE_HEADERS });

    if (!response.ok) return '';

    const html = await response.text();
    const sample = html.slice(0, 60000).replace(/<[^>]+>/g, ' ');
    const normalizedSample = stripDiacritics(sample).toLowerCase();

    if (allowedHost === 'lubimyczytac.pl') {
      const hasNotFoundSignal =
        normalizedSample.includes('strona nie istnieje') ||
        normalizedSample.includes('nie znaleziono strony') ||
        normalizedSample.includes('blad 404') ||
        normalizedSample.includes('error 404');
      if (hasNotFoundSignal) return '';
    }

    if (allowedHost === 'goodreads.com') {
      const hasNotFoundSignal =
        normalizedSample.includes('page not found') ||
        normalizedSample.includes('error 404') ||
        normalizedSample.includes('sorry, we could not find');
      if (hasNotFoundSignal) return '';
    }

    const baseScore = scoreUrlCandidate(clean, title, author);
    const authorScore = scoreAuthorPresenceInText(sample, author);
    const titleScore = scoreTitlePresenceInText(sample, title);
    const qualityPenalty = containsLowQualityBookSignals(sample.slice(0, 12000)) ? 2 : 0;
    const score = baseScore + (authorScore * 2) + titleScore - qualityPenalty;

    console.log(`[URL lookup] verified direct url: ${score.toFixed(3)}(base:${baseScore.toFixed(3)},author:${authorScore.toFixed(3)},title:${titleScore.toFixed(3)},penalty:${qualityPenalty.toFixed(1)}):${clean}`);

    if (score < 1.0) return '';
    if (titleScore < 0.35) return '';
    if (author.trim() && authorScore < 0.4) return '';
    return clean;
  } catch (error: any) {
    console.warn(`[URL lookup] direct url verification failed for ${clean}:`, error?.message || String(error));
    return '';
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
      const response = await fetch(item.url, { headers: SCRAPE_HEADERS });

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

async function rankGoodreadsCandidatesForIsbn(urls: string[], author: string): Promise<string> {
  if (urls.length === 0) return '';

  const candidates = urls.slice(0, 5);
  const scored = [] as Array<{
    url: string;
    score: number;
    authorScore: number;
    qualityPenalty: number;
    positionBonus: number;
  }>;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    let authorScore = 0;
    let qualityPenalty = qualityPenaltyFromUrl(url);
    const positionBonus = Math.max(0, 1 - (index * 0.2));

    try {
      const response = await fetch(url, { headers: SCRAPE_HEADERS });

      if (response.ok) {
        const html = await response.text();
        const sample = html.slice(0, 60000).replace(/<[^>]+>/g, ' ');
        authorScore = scoreAuthorPresenceInText(sample, author);
        if (containsLowQualityBookSignals(sample.slice(0, 12000))) {
          qualityPenalty += 2;
        }
      }
    } catch {
      // keep current score if fetch fails
    }

    const score = positionBonus + (authorScore * 2) - qualityPenalty;
    scored.push({ url, score, authorScore, qualityPenalty, positionBonus });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored
    .slice(0, 3)
    .map((entry) => `${entry.score.toFixed(3)}(author:${entry.authorScore.toFixed(3)},position:${entry.positionBonus.toFixed(3)},penalty:${entry.qualityPenalty.toFixed(1)}):${entry.url}`);
  console.log(`[URL lookup] goodreads isbn-ranked candidates: ${top.join(' | ')}`);

  const best = scored[0];
  if (!best) return '';
  if (author.trim() && best.authorScore >= 0.4) return best.url;
  // Only accept if author score is decent; never accept with score 0 just because there's no quality penalty
  return '';
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

async function findBookUrlOnLubimyCzytac(title: string, author: string, isbns: string[] = []): Promise<string> {
  const safeTitle = (title || '').trim();
  const safeAuthor = (author || '').trim();
  if (!safeTitle && isbns.length === 0) return '';

  // If we have ISBN, prioritize ISBN-based search first
  if (isbns.length > 0) {
    for (const isbn of isbns) {
      const url = `https://lubimyczytac.pl/szukaj/ksiazki?phrase=${encodeURIComponent(isbn)}`;
      console.log(`[URL lookup] lubimyczytac isbn query: ${isbn}`);

      try {
        const response = await fetch(url, { headers: SCRAPE_HEADERS });
        console.log(`[URL lookup] lubimyczytac isbn status: ${response.status}`);
        if (!response.ok) continue;

        const html = await response.text();
        const candidates = extractCandidatesWithContext(
          html,
          /href=["'](\/ksiazka\/[0-9]+(?:\/[^"]*)?)["']/g,
          'lubimyczytac.pl'
        );
        console.log(`[URL lookup] lubimyczytac isbn extracted: ${candidates.length}`);
        if (candidates.length === 0) continue;

        // For ISBN results, only use confident scoring — do not fall back to candidates[0]
        // (ISBN phrase search often returns irrelevant results; fall through to title search if unsure)
        const selected = rankCandidatesWithContextScores(candidates, safeTitle, safeAuthor);
        console.log(`[URL lookup] lubimyczytac isbn selected: ${selected || '(empty)'}`);
        if (selected) return selected;
      } catch (error: any) {
        console.warn('[URL lookup] lubimyczytac isbn failed:', error?.message || String(error));
      }
    }
    console.log('[URL lookup] lubimyczytac isbn search exhausted, falling back to title query');
  }

  // Fallback to title-based search only if no ISBN available
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
    console.log(`[URL lookup] lubimyczytac title query: ${q}`);

    try {
      const response = await fetch(url, { headers: SCRAPE_HEADERS });
      console.log(`[URL lookup] lubimyczytac title status: ${response.status}`);
      if (!response.ok) continue;

      const html = await response.text();
      const candidates = extractCandidatesWithContext(
        html,
        /href=["'](\/ksiazka\/[0-9]+(?:\/[^"]*)?)["']/g,
        'lubimyczytac.pl'
      );
      console.log(`[URL lookup] lubimyczytac title extracted: ${candidates.length}`);

      for (const { url: candidateUrl, context } of candidates) {
        if (!allCandidates.has(candidateUrl)) {
          allCandidates.set(candidateUrl, context);
        }
      }
    } catch (error: any) {
      console.warn('[URL lookup] lubimyczytac title failed:', error?.message || String(error));
    }
  }

  if (allCandidates.size === 0) return '';

  const merged = Array.from(allCandidates.entries()).map(([u, ctx]) => ({ url: u, context: ctx }));
  const selected = rankCandidatesWithContextScores(merged, safeTitle, safeAuthor);
  console.log(`[URL lookup] lubimyczytac title selected: ${selected || '(empty)'}`);
  return selected;
}

async function findBookUrlOnGoodreads(title: string, author: string, isbns: string[] = []): Promise<string> {
  const safeTitle = (title || '').trim();
  const safeAuthor = (author || '').trim();
  if (!safeTitle && isbns.length === 0) return '';

  // If we have ISBN, prioritize ISBN-based search only
  if (isbns.length > 0) {
    for (const isbn of isbns) {
      const url = `https://www.goodreads.com/search?q=${encodeURIComponent(isbn)}`;
      console.log(`[URL lookup] goodreads isbn query: ${isbn}`);

      try {
        const response = await fetch(url, { headers: SCRAPE_HEADERS });
        console.log(`[URL lookup] goodreads isbn status: ${response.status}`);
        if (!response.ok) continue;

        const html = await response.text();
        const urls = extractUrlsByRegex(
          html,
          /href=["']((?:https?:\/\/(?:www\.)?goodreads\.com)?\/book\/show\/[^"']+)["']/g,
          'goodreads.com'
        );
        console.log(`[URL lookup] goodreads isbn extracted: ${urls.length}`);
        if (urls.length === 0) continue;

        // For ISBN results, only use confident scoring — do not fall back to urls[0]
        const selected = await rankGoodreadsCandidatesForIsbn(urls, safeAuthor);
        console.log(`[URL lookup] goodreads isbn selected: ${selected || '(empty)'}`);
        if (selected) return selected;
      } catch (error: any) {
        console.warn('[URL lookup] goodreads isbn failed:', error?.message || String(error));
      }
    }
    console.log('[URL lookup] goodreads isbn search exhausted, falling back to title query');
  }

  // Fallback to title-based search only if no ISBN available
  const asciiTitle = stripDiacritics(safeTitle);
  const asciiAuthor = stripDiacritics(safeAuthor);
  const queries = [
    { value: `${safeTitle} ${safeAuthor}`.trim(), kind: 'title' as const },
    { value: safeTitle, kind: 'title' as const },
    { value: `${asciiTitle} ${asciiAuthor}`.trim(), kind: 'title' as const },
    { value: asciiTitle, kind: 'title' as const },
  ].filter((entry) => entry.value);

  for (const query of queries) {
    const q = query.value;
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
    console.log(`[URL lookup] goodreads title query: ${q}`);

    try {
      const response = await fetch(url, { headers: SCRAPE_HEADERS });
      console.log(`[URL lookup] goodreads title status: ${response.status}`);
      if (!response.ok) continue;

      const html = await response.text();
      const urls = extractUrlsByRegex(
        html,
        /href=["']((?:https?:\/\/(?:www\.)?goodreads\.com)?\/book\/show\/[^"']+)["']/g,
        'goodreads.com'
      );
      console.log(`[URL lookup] goodreads title extracted: ${urls.length}`);
      if (urls.length === 0) continue;

      const selected = await rankCandidatesWithAuthorVerification(urls, safeTitle, safeAuthor);
      console.log(`[URL lookup] goodreads title selected: ${selected || '(empty)'}`);
      if (selected) return selected;
    } catch (error: any) {
      console.warn('[URL lookup] goodreads title failed:', error?.message || String(error));
    }
  }

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
  isbns?: string[];
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
  const identifierValues = collectTextValues(metadata.identifier);
  const isbnOccurrences: IsbnOccurrence[] = [];

  for (const value of identifierValues) {
    isbnOccurrences.push(...extractIsbnOccurrencesFromText(value));
  }

  for (const value of collectTextValues(metadata.meta).filter((item) => /isbn/i.test(item))) {
    isbnOccurrences.push(...extractIsbnOccurrencesFromText(value));
  }

  isbnOccurrences.push(...extractIsbnOccurrencesFromText(opfXml));
  
  // Additionally search front-matter XHTML files (title page, editorial page, etc.)
  // for ISBNs that may be embedded in content rather than metadata
  try {
    const manifest = opfObj?.package?.manifest?.item;
    if (manifest) {
      const items = Array.isArray(manifest) ? manifest : [manifest];
      
      // Look for likely ISBN-containing files: title pages, editorial pages, legal notices
      const isbnLikelyFiles = items.filter((item: any) => {
        if (item?.['@_media-type'] !== 'application/xhtml+xml') return false;
        const href = item?.['@_href'] || '';
        const hrefLower = href.toLowerCase();
        
        // Match common names for title/copyright/editorial pages
        return /(?:title|redakcyjna|editorial|copyright|legal|colophon|info|cover|verso|recto)/i.test(hrefLower);
      });
      
      // Extract and search these files
      for (const item of isbnLikelyFiles) {
        const href = item?.['@_href'];
        if (!href) continue;
        
        // Resolve relative path from OPF directory
        const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
        const fullPath = opfDir ? `${opfDir}/${href}` : href;
        
        try {
          const xhtmlFile = zip.file(fullPath);
          if (xhtmlFile) {
            const xhtmlContent = await xhtmlFile.async('text');
            isbnOccurrences.push(...extractIsbnOccurrencesFromText(xhtmlContent));
          }
        } catch {
          // Skip if file cannot be read
        }
      }
    }
  } catch {
    // If manifest parsing fails, continue with OPF-only context
  }
  
  const isbns = rankIsbnOccurrences(isbnOccurrences, 'epub');

  if (!title && !author && !description) return null;

  return {
    title,
    author,
    language,
    description,
    isbns,
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
      const isbns = extractIsbnsFromValues(collectTextValues(metadata).filter((value) => /isbn/i.test(value) || /97[89]/.test(value)));
      kf8.destroy();

      if (!title && !author && !description) return null;

      return {
        title,
        author,
        language,
        description,
        isbns,
        source: 'kf8-metadata',
      };
    }

    const mobi = await mobiParser.initMobiFile(fileBytes);
    const metadata = mobi.getMetadata();
    const title = metadata.title?.trim();
    const author = extractAuthorString(metadata.author);
    const language = metadata.language?.trim();
    const description = metadata.description?.trim();
    const isbns = extractIsbnsFromValues(collectTextValues(metadata).filter((value) => /isbn/i.test(value) || /97[89]/.test(value)));
    mobi.destroy();

    if (!title && !author && !description) return null;

    return {
      title,
      author,
      language,
      description,
      isbns,
      source: 'mobi-metadata',
    };
  } catch (error: any) {
    console.warn('MOBI/KF8 extraction skipped:', error?.message || String(error));
    return null;
  }
}

serve(async (req: Request) => {
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
      userId = null,
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

    // 2. Resolve ISBN first (if available) to get canonical title/author
    const extractedIsbns = fileMeta?.isbns || [];
    const isbnResolvedMeta = extractedIsbns.length > 0 ? await resolveBookByIsbn(extractedIsbns) : null;
    const isbnAiResolvedMeta = extractedIsbns.length > 0
      ? await resolveBookByIsbnWithAi(
        openAiKey || '',
        extractedIsbns,
        fileMeta?.title || normalizedFileTitle,
        fileMeta?.author || ''
      )
      : null;
    console.log(`[ISBN lookup] extracted: ${extractedIsbns.join(', ') || '(none)'}`);
    console.log(`[ISBN lookup] resolved title: ${isbnResolvedMeta?.title || '(empty)'} author: ${isbnResolvedMeta?.author || '(empty)'}`);
    console.log(`[ISBN AI lookup] resolved title: ${isbnAiResolvedMeta?.title || '(empty)'} goodreads: ${isbnAiResolvedMeta?.goodreads_url || '(empty)'} lubimyczytac: ${isbnAiResolvedMeta?.lubimyczytac_url || '(empty)'}`);

    // Only ISBN resolution is strong enough to assume we already know the original work.
    // File metadata can still contain a translated/localized edition title.
    const hasCanonicalIdentity = Boolean(isbnAiResolvedMeta?.title || isbnResolvedMeta?.title);
    const canonicalTitle = isbnAiResolvedMeta?.title || isbnResolvedMeta?.title || fileMeta?.title || normalizedFileTitle;
    const canonicalAuthor = normalizeAuthorName(isbnAiResolvedMeta?.author || isbnResolvedMeta?.author || fileMeta?.author || '');

    // 3. Call GPT for enrichment: either to translate a known book, or to identify an unknown one
    let metadata: any;
    if (hasCanonicalIdentity) {
      // Path A: We have a strong identity from ISBN. Resolve the original work
      // and return both original/English and Polish metadata so downstream URL lookup uses the right title.
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
              content: `You are an expert multilingual librarian. Given a book title and author from authoritative metadata with a verified ISBN, determine the underlying original work and produce bilingual metadata.

TASK:
- Input may be an original title OR a localized/translated edition title.
- First determine the underlying work.
- Return the original or canonical English title in "title" whenever the work is not originally Polish.
- If the work is originally Polish, keep the Polish original title in "title".
- Return a proper English description in "description".
- Return the official Polish title in "title_pl" when one exists; otherwise provide a natural Polish translation.
- Return a natural Polish description in "description_pl".

RULES:
- Do not return a literal 1:1 translation when a known official title exists.
- If the provided title is already a translated/localized edition title, map it back to the original work before writing "title".
- Do not invent a different book. Lower confidence if unsure.

Output a JSON object:
{
  "title": "Original/canonical title of the work in English, or original Polish title for Polish-original works",
  "title_pl": "Official Polish title if known, else natural Polish translation",
  "description": "3-4 sentence English summary",
  "description_pl": "3-4 sentence Polish summary (natural Polish prose)",
  "genre": "Primary genre",
  "moods": ["mood1", "mood2", "mood3"],
  "confidence": "high | medium | low",
  "notes": "Any useful context"
}`
            },
            {
              role: 'user',
              content: `Authoritative title: "${canonicalTitle}"\nAuthoritative author: "${canonicalAuthor}"\nOriginal filename: "${fileName}"\nISBN candidates: ${JSON.stringify(extractedIsbns)}\n\nDetermine the underlying work first. Then return both original/canonical title and Polish title plus both English and Polish descriptions.`
            }
          ],
          response_format: { type: 'json_object' },
        }),
      });

      const metaData = await metaResponse.json();
      if (!metaData.choices?.[0]?.message?.content) {
        throw new Error(`OpenAI Polish translation call failed: ${JSON.stringify(metaData)}`);
      }
      metadata = JSON.parse(metaData.choices[0].message.content);
    } else {
      // Path B: Weak or missing identity → ask GPT to identify the book (original two-step logic)
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
- Also extract the author if present in the filename.
- Ignore uploader/user nicknames or account names. Use only real author names.

STEP 2 — BILINGUAL METADATA:
From your knowledge of the resolved book/work, produce bilingual metadata.
- If filename is ambiguous (very short, no author), set confidence to "low" and keep the filename title as-is.
- Never return study guides, summaries, analyses, or companion notes as the main book.

Output a single JSON object:
{
  "title": "Original/English title",
  "title_pl": "Polish translation title or natural Polish translation",
  "author": "Full author name(s)",
  "genre": "Primary genre",
  "description": "3-4 sentence English summary",
  "description_pl": "3-4 sentence Polish summary",
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
              })}\n\nExtracted file metadata: ${JSON.stringify(fileMeta || null)}\n\nDetect language and resolve the original work, then provide bilingual metadata.`
            }
          ],
          response_format: { type: 'json_object' },
        }),
      });

      const metaData = await metaResponse.json();
      if (!metaData.choices?.[0]?.message?.content) {
        throw new Error(`OpenAI metadata call failed: ${JSON.stringify(metaData)}`);
      }
      metadata = JSON.parse(metaData.choices[0].message.content);
    }

    const modelFileTitle = (fileMeta?.title || normalizedFileTitle || metadata.title || fileName).trim();
    const modelTitle = (isbnAiResolvedMeta?.title || metadata.title || (hasCanonicalIdentity ? canonicalTitle : modelFileTitle) || modelFileTitle).trim();
    const modelTitlePl = (isbnAiResolvedMeta?.title_pl || metadata.title_pl || modelFileTitle || modelTitle).trim();
    const modelAuthor = normalizeAuthorName(isbnAiResolvedMeta?.author || (hasCanonicalIdentity ? (canonicalAuthor || metadata.author || '') : (metadata.author || ''))) || 'Unknown';
    const modelGenre = metadata.genre || 'Unknown';
    const modelDescription = metadata.description || fileMeta?.description || isbnResolvedMeta?.description || 'No description available.';
    const modelDescriptionPl = metadata.description_pl || modelDescription;
    const modelMoods: string[] = Array.isArray(metadata.moods) ? metadata.moods.slice(0, 5) : [];
    const modelConfidence = clampConfidence(metadata.confidence);
    let title_alt: string = '';
    let lubimyczytac_url = '';
    let goodreads_url = '';

    const sourceNotes = [
      fileMeta ? `source:${fileMeta.source}` : '',
      driveMeta?.mimeType ? `mime:${driveMeta.mimeType}` : '',
      extractedIsbns.length > 0 ? `isbn:${extractedIsbns[0]}` : '',
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
    const hasTrustedLookupIdentity = Boolean(
      extractedIsbns.length > 0 ||
      isbnResolvedMeta?.title ||
      (!shouldUseFallback && title.trim() && author.trim() && confidence !== 'low') ||
      (fileMeta?.title && fileMeta?.author)
    );
    const lubimyCzytacSearchTitle = (title_pl || file_title || title).trim();
    const goodreadsSearchTitle = (title || file_title).trim();

    const isbnOverride = extractedIsbns
      .map((isbn) => ISBN_URL_OVERRIDES[isbn])
      .find((value) => Boolean(value));
    if (isbnOverride?.lubimyczytac_url) {
      lubimyczytac_url = sanitizeResolvedBookPageUrl(isbnOverride.lubimyczytac_url, 'lubimyczytac.pl');
      console.log(`[URL override] lubimyczytac from isbn map: ${lubimyczytac_url || '(empty)'}`);
    }
    if (isbnOverride?.goodreads_url) {
      goodreads_url = sanitizeResolvedBookPageUrl(isbnOverride.goodreads_url, 'goodreads.com');
      console.log(`[URL override] goodreads from isbn map: ${goodreads_url || '(empty)'}`);
    }

    // Hybrid URL resolution (multi-agent consensus):
    // 1) ISBN AI suggestion
    // 2) title-based AI suggestion
    // 3) HTML scraper suggestion
    // then strict page verification accepts only a matching book.
    if (hasTrustedLookupIdentity && !lubimyczytac_url) {
      lubimyczytac_url = await resolveHybridBookUrl({
        host: 'lubimyczytac.pl',
        openAiKey: openAiKey || '',
        title: goodreadsSearchTitle,
        titlePl: lubimyCzytacSearchTitle,
        author,
        isbns: extractedIsbns,
        isbnAiUrl: isbnAiResolvedMeta?.lubimyczytac_url,
      });
    }

    if (hasTrustedLookupIdentity && !goodreads_url) {
      goodreads_url = await resolveHybridBookUrl({
        host: 'goodreads.com',
        openAiKey: openAiKey || '',
        title: goodreadsSearchTitle,
        titlePl: lubimyCzytacSearchTitle,
        author,
        isbns: extractedIsbns,
        isbnAiUrl: isbnAiResolvedMeta?.goodreads_url,
      });
    }

    console.log(`[URL lookup] trusted identity: ${hasTrustedLookupIdentity ? 'yes' : 'no'}`);
    console.log(`[URL lookup] final lubimyczytac_url: ${lubimyczytac_url || '(empty)'}`);
    console.log(`[URL lookup] final goodreads_url: ${goodreads_url || '(empty)'}`);

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
        isbn: extractedIsbns[0] || null,
        ...(parsedDriveUploadedAt ? { drive_uploaded_at: parsedDriveUploadedAt } : {}),
        embedding,
        user_id: userId || user.id
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
