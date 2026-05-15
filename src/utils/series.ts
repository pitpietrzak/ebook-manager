import { supabase } from './supabase';

type AssignSeriesInput = {
  bookId: string;
  seriesName?: string | null;
  seriesPart?: number | null;
};

function normalizeSeriesPart(value?: number | null): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? rounded : null;
}

async function resolveSeriesId(seriesName: string, userId?: string): Promise<string> {
  const cleanName = seriesName.trim();
  if (!cleanName) throw new Error('Series name is required.');

  const { data: existing } = await supabase
    .from('series')
    .select('id')
    .ilike('name', cleanName)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('series')
    .insert({
      name: cleanName,
      created_by: userId || null,
    })
    .select('id')
    .single();

  if (insertError) {
    // Race-safe fallback: another client could insert same name at the same time.
    const { data: fallback } = await supabase
      .from('series')
      .select('id')
      .ilike('name', cleanName)
      .maybeSingle();

    if (fallback?.id) return fallback.id;
    throw insertError;
  }

  return inserted.id;
}

export async function assignBookSeries({ bookId, seriesName, seriesPart }: AssignSeriesInput): Promise<void> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;

  const cleanName = (seriesName || '').trim();
  const normalizedPart = normalizeSeriesPart(seriesPart);

  if (!cleanName) {
    const { error } = await supabase
      .from('books')
      .update({
        series_id: null,
        series_part: null,
      })
      .eq('id', bookId);

    if (error) throw error;
    return;
  }

  const seriesId = await resolveSeriesId(cleanName, userId);

  const { error } = await supabase
    .from('books')
    .update({
      series_id: seriesId,
      series_part: normalizedPart,
    })
    .eq('id', bookId);

  if (error) throw error;
}
