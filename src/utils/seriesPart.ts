// Shared by SeriesAssignmentModal and FolderSeriesAssignmentModal.
export function parseSeriesPart(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? rounded : null;
}
