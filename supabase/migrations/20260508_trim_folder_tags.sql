-- Trim leading/trailing whitespace from all folder_tags array elements
-- Fixes books where Google Drive folder names were stored with trailing spaces
UPDATE books
SET folder_tags = ARRAY(
  SELECT TRIM(t) FROM unnest(folder_tags) t
)
WHERE folder_tags IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(folder_tags) t WHERE t <> TRIM(t)
  );
