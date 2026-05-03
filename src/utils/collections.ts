// Utility to count and sort collections alphabetically
type BookWithTags = {
  folder_tags?: string[] | null;
};

export function getSortedCollections(books: BookWithTags[]): { name: string; count: number }[] {
  const tagCounts: Record<string, number> = {};
  const isUncategorised = (name: string) => name === 'Uncategorised' || name === 'Uncategorized';

  books.forEach((book) => {
    const tags = book.folder_tags || [];
    if (tags.length === 0) {
      tagCounts['Uncategorised'] = (tagCounts['Uncategorised'] || 0) + 1;
    } else {
      tags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  return Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const aPriority = isUncategorised(a.name) ? 0 : 1;
      const bPriority = isUncategorised(b.name) ? 0 : 1;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}
