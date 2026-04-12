import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, RefreshControl, SafeAreaView
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { supabase } from '../utils/supabase';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { useBookUpload } from '../hooks/useBookUpload';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Library'>;
  route: RouteProp<RootStackParamList, 'Library'>;
};

type Book = {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  description_pl?: string | null;
  goodreads_url?: string;
  lubimyczytac_url?: string;
  moods: string[];
  folder_tags: string[];
};

export default function LibraryScreen({ navigation, route }: Props) {
  const collectionFilter = route.params?.collectionFilter ?? null;
  const autoFocusSearch = route.params?.autoFocusSearch ?? false;

  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [displayedBooks, setDisplayedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResults, setAiResults] = useState<Book[] | null>(null);

  const { startUpload, isUploading, uploadNode } = useBookUpload(() => fetchBooks());

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (autoFocusSearch) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [autoFocusSearch]);

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('books').select('*').order('created_at', { ascending: false });

    if (collectionFilter === '__uncategorised__') {
      // Books with no folder tags at all
      query = query.or('folder_tags.is.null,folder_tags.eq.{}');
    } else if (collectionFilter) {
      query = query.contains('folder_tags', [collectionFilter]);
    }

    const { data, error } = await query;
    if (!error && data) {
      setAllBooks(data);
      setDisplayedBooks(data);
    }
    setLoading(false);
    setRefreshing(false);
  }, [collectionFilter]);

  useEffect(() => { fetchBooks(); }, [fetchBooks]);

  // Debounced local search across both language versions
  useEffect(() => {
    if (aiSearchMode) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!searchQuery.trim()) {
      setDisplayedBooks(allBooks);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      const q = searchQuery.toLowerCase();
      const filtered = allBooks.filter(b =>
        b.title?.toLowerCase().includes(q) ||
        b.title_pl?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.genre?.toLowerCase().includes(q) ||
        b.moods?.some(m => m.toLowerCase().includes(q)) ||
        b.folder_tags?.some(t => t.toLowerCase().includes(q))
      );
      setDisplayedBooks(filtered);
    }, 300);
  }, [searchQuery, allBooks, aiSearchMode]);

  const handleAiSearch = async () => {
    if (!searchQuery.trim()) return;
    setAiSearching(true);
    setAiResults(null);

    const { data, error } = await supabase.functions.invoke('ai-search', {
      body: { query: searchQuery }
    });

    setAiSearching(false);
    if (!error && data) {
      setAiResults(data);
    } else {
      Alert.alert('Search Error', error?.message || 'AI search failed');
    }
  };

  const clearAiSearch = () => {
    setAiResults(null);
    setSearchQuery('');
  };

  const booksToShow = aiResults ?? displayedBooks;

  const renderBook = ({ item }: { item: Book }) => {
    return (
      <TouchableOpacity
        style={styles.bookCard}
        onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
        activeOpacity={0.75}
      >
        <View style={styles.bookCardLeft}>
          <View style={styles.bookCover}>
            <Text style={styles.bookCoverInitial}>{item.title?.[0] ?? '?'}</Text>
          </View>
        </View>
        <View style={styles.bookInfo}>
          <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.bookAuthor} numberOfLines={1}>{item.author || 'Unknown Author'}</Text>
          {item.genre ? <Text style={styles.bookGenre}>{item.genre}</Text> : null}
          {item.moods?.length > 0 && (
            <View style={styles.moodRow}>
              {item.moods.slice(0, 3).map(m => (
                <View key={m} style={styles.moodChip}>
                  <Text style={styles.moodChipText}>{m}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.searchBar}>
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder={aiSearchMode ? '✨ Describe what you want to read...' : '🔍 Search title, author, genre, mood...'}
          placeholderTextColor="#AAA"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={aiSearchMode ? handleAiSearch : undefined}
          returnKeyType={aiSearchMode ? 'search' : 'default'}
        />
        <TouchableOpacity
          style={[styles.aiToggle, aiSearchMode && styles.aiToggleActive]}
          onPress={() => { setAiSearchMode(v => !v); setAiResults(null); setSearchQuery(''); }}
        >
          <Text style={[styles.aiToggleText, aiSearchMode && styles.aiToggleTextActive]}>AI</Text>
        </TouchableOpacity>
      </View>

      {aiSearchMode && (
        <View style={styles.aiBar}>
          <Text style={styles.aiHint}>Type a mood, theme or description and tap Search</Text>
          <View style={styles.aiActions}>
            <TouchableOpacity style={styles.aiSearchBtn} onPress={handleAiSearch} disabled={aiSearching}>
              {aiSearching
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.aiSearchBtnText}>Search</Text>
              }
            </TouchableOpacity>
            {aiResults && (
              <TouchableOpacity style={styles.clearBtn} onPress={clearAiSearch}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {aiResults && (
        <View style={styles.aiResultsHeader}>
          <Text style={styles.aiResultsLabel}>✨ AI Results for "{searchQuery}"</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#531492" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={booksToShow}
          keyExtractor={item => item.id}
          renderItem={renderBook}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBooks(); }} tintColor="#531492" />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>
                {searchQuery ? `No books matching "${searchQuery}"` : 'No books in this collection yet'}
              </Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, isUploading && { backgroundColor: '#AAA' }]}
        onPress={() => startUpload(collectionFilter)}
        disabled={isUploading}
      >
        {isUploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.fabText}>+</Text>}
      </TouchableOpacity>

      {uploadNode}
      
      {isUploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.uploadingText}>Uploading & Processing...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const PURPLE_MAIN = '#531492';
const PINK_ACCENT = '#E80F88';

const styles = StyleSheet.create({
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(83, 20, 146, 0.7)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100, elevation: 100,
  },
  uploadingText: {
    color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 16
  },
  safe: { flex: 1, backgroundColor: '#FDF8FF' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EFEFEF',
  },
  searchInput: {
    flex: 1, height: 42, backgroundColor: '#F0F5F2', borderRadius: 12,
    paddingHorizontal: 14, fontSize: 14, color: '#1A1A2E',
  },
  aiToggle: {
    width: 44, height: 42, borderRadius: 12, backgroundColor: '#F0F5F2',
    justifyContent: 'center', alignItems: 'center',
  },
  aiToggleActive: { backgroundColor: PINK_ACCENT },
  aiToggleText: { fontWeight: '700', fontSize: 13, color: '#888' },
  aiToggleTextActive: { color: '#fff' },
  aiBar: {
    backgroundColor: '#FFF5F2', paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  aiHint: { fontSize: 12, color: PINK_ACCENT, flex: 1 },
  aiActions: { flexDirection: 'row', gap: 8 },
  aiSearchBtn: {
    backgroundColor: PINK_ACCENT, paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, minWidth: 70, alignItems: 'center',
  },
  aiSearchBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn: {
    backgroundColor: '#FDE4DD', paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20,
  },
  clearBtnText: { color: PINK_ACCENT, fontWeight: '600', fontSize: 13 },
  aiResultsHeader: { backgroundColor: '#F5E8FA', paddingHorizontal: 16, paddingVertical: 8 },
  aiResultsLabel: { color: PURPLE_MAIN, fontWeight: '600', fontSize: 13 },
  bookCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14,
    marginBottom: 12, padding: 14, overflow: 'hidden',
    shadowColor: PURPLE_MAIN, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  bookCardLeft: { marginRight: 14 },
  bookCover: {
    width: 52, height: 72, borderRadius: 8, backgroundColor: PURPLE_MAIN + '22',
    justifyContent: 'center', alignItems: 'center',
  },
  bookCoverInitial: { fontSize: 24, fontWeight: '700', color: PURPLE_MAIN },
  bookInfo: { flex: 1 },
  bookTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A2E', marginBottom: 2 },
  bookAuthor: { fontSize: 13, color: '#666', marginBottom: 4 },
  bookGenre: { fontSize: 12, color: PURPLE_MAIN, fontWeight: '600', marginBottom: 6 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  moodChip: {
    backgroundColor: '#F5E8FA', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  moodChipText: { fontSize: 11, color: '#71229F', fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 58, height: 58,
    borderRadius: 29, backgroundColor: PURPLE_MAIN, justifyContent: 'center',
    alignItems: 'center', elevation: 5,
    shadowColor: PURPLE_MAIN, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
