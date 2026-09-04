import { supabase } from './supabase';

// Fetches the set of book ids the given user has marked as read.
export async function fetchReadBookIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('book_reads')
    .select('book_id')
    .eq('user_id', userId);

  if (error) {
    console.warn('Failed to load read books:', error.message);
    return new Set();
  }

  return new Set((data || []).map((row: any) => row.book_id));
}

export async function setBookReadState(userId: string, bookId: string, isRead: boolean): Promise<void> {
  if (isRead) {
    const { error } = await supabase
      .from('book_reads')
      .upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('book_reads')
      .delete()
      .eq('user_id', userId)
      .eq('book_id', bookId);
    if (error) throw error;
  }
}
