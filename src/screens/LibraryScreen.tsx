import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList, LibraryStackParamList } from '../../App';
import { supabase } from '../utils/supabase';
import { invokeEdgeFunctionWithRetry } from '../utils/supabaseFunctions';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { useBookUpload } from '../hooks/useBookUpload';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/ProfileContext';
import { StatusBar } from 'react-native';
import { 
  Search, Plus, Sparkles, Inbox, Book as BookIcon, 
  ChevronRight, Filter, Clock, RefreshCw, Folder as FolderIcon,
  ChevronLeft, CheckCircle2
} from 'lucide-react-native';
import SyncModal from './SyncModal';
import DynamicIcon from '../components/DynamicIcon';
import IconPickerModal from '../components/IconPickerModal';
import { getSortedCollections } from '../utils/collections';

type Props = {
  navigation: CompositeNavigationProp<
    NativeStackNavigationProp<LibraryStackParamList, 'LibraryHome'>,
    CompositeNavigationProp<
      BottomTabNavigationProp<TabParamList, 'Library'>,
      NativeStackNavigationProp<RootStackParamList>
    >
  >;
  route: RouteProp<LibraryStackParamList, 'LibraryHome'> | RouteProp<LibraryStackParamList, 'LibraryCatalog'>;
};

type Book = {
  id: string;
  title: string;
  alt_title?: string | null;
  author: string;
  genre: string;
  description: string;
  description_pl?: string | null;
  goodreads_url?: string;
  lubimyczytac_url?: string;
  verified?: boolean;
  moods: string[];
  folder_tags: string[];
  user_id: string;
  profiles?: { display_name: string } | null;
};

const COLLECTION_COLORS = ['#8B5CF6', '#D946EF', '#F43F5E', '#6366F1', '#EC4899', '#3B82F6', '#06B6D4', '#10B981'];

export default function LibraryScreen({ navigation, route }: Props) {
  const collectionFilter = route.params?.collectionFilter ?? null;
  const autoFocusSearch = route.params?.autoFocusSearch ?? false;

  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [displayedBooks, setDisplayedBooks] = useState<Book[]>([]);
  const [collections, setCollections] = useState<{name: string, count: number}[]>([]);
  const [iconMap, setIconMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editingCollection, setEditingCollection] = useState<{ name: string; index: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResults, setAiResults] = useState<Book[] | null>(null);
  const { colors, isDark, viewMode } = useTheme();
  const { profile } = useProfile();

  const { startUpload, isUploading, uploadNode } = useBookUpload(() => fetchBooks());
  const styles = getStyles(colors, isDark);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (autoFocusSearch) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [autoFocusSearch]);

  const fetchCollections = useCallback(async (books: Book[]) => {
    const sorted = getSortedCollections(books);
    setCollections(sorted);
    fetchCollectionIcons(sorted.map(c => c.name));
  }, []);

  const fetchCollectionIcons = async (names: string[]) => {
    try {
      const { data } = await supabase.from('collection_icons').select('name, icon_name').in('name', names);
      const newMap: Record<string, string> = {};
      data?.forEach(row => { newMap[row.name] = row.icon_name; });
      setIconMap(prev => ({ ...prev, ...newMap }));
    } catch (e) {
      console.warn('Icon fetch failed:', e);
    }
  };

// Handle special cases for collectionFilter
  const isAllView = collectionFilter === '__all__';
  const isHomeView = collectionFilter === null;

  const openLibraryHome = () => {
    navigation.navigate('LibraryHome', { collectionFilter: null });
  };

  const openCollection = (targetFilter: string) => {
    navigation.navigate('LibraryCatalog', { collectionFilter: targetFilter });
  };

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    let tryQuery = supabase
      .from('books')
      .select('*, profiles(display_name)')
      .order('drive_uploaded_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    
    if (collectionFilter === '__uncategorised__') {
      tryQuery = tryQuery.or('folder_tags.is.null,folder_tags.eq.{}');
    } else if (collectionFilter && !isAllView) {
      const tag = collectionFilter.trim();
      tryQuery = tryQuery.filter('folder_tags', 'cs', `{"${tag.replace(/"/g, '\\"')}"}`);
    }

    const { data, error } = await tryQuery;
    
    if (!error && data) {
      setAllBooks(data);
      setDisplayedBooks(data);
      if (isHomeView) fetchCollections(data);
    } else {
      // Fallback (strict filtering)
      let fallbackQuery = supabase
        .from('books')
        .select('*')
        .order('drive_uploaded_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (collectionFilter === '__uncategorised__') {
        fallbackQuery = fallbackQuery.or('folder_tags.is.null,folder_tags.eq.{}');
      } else if (collectionFilter && !isAllView) {
        const tag = collectionFilter.trim();
        fallbackQuery = fallbackQuery.filter('folder_tags', 'cs', `{"${tag.replace(/"/g, '\\"')}"}`);
      }
      
      const { data: fallbackData } = await fallbackQuery;
      if (fallbackData) {
        setAllBooks(fallbackData);
        setDisplayedBooks(fallbackData);
        if (isHomeView) fetchCollections(fallbackData);
      }
    }
    
    setLoading(false);
    setRefreshing(false);
  }, [collectionFilter, isAllView, isHomeView, fetchCollections]);

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
        b.alt_title?.toLowerCase().includes(q) ||
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

    try {
      const { data, error } = await invokeEdgeFunctionWithRetry('ai-search', {
        body: { query: searchQuery }
      });

      if (error) throw error;
      setAiResults(Array.isArray(data) ? data : []);
    } catch (e: any) {
      Alert.alert('Search Error', e?.message || 'AI search failed');
      setAiResults([]);
    } finally {
      setAiSearching(false);
    }
  };

  const clearAiSearch = () => {
    setAiResults(null);
    setSearchQuery('');
  };

  const handleIconSelect = async (iconName: string) => {
    if (!editingCollection) return;

    const { name } = editingCollection;

    setIconMap(prev => ({ ...prev, [name]: iconName }));
    setPickerVisible(false);

    try {
      const { error } = await supabase
        .from('collection_icons')
        .upsert({ name, icon_name: iconName });

      if (error) throw error;
    } catch (e) {
      console.error('Failed to save icon:', e);
    }
  };

  // Hide books on home explorer view unless searching or AI results exist
  const booksToShow = (isHomeView && !searchQuery && !aiResults) ? [] : (aiResults ?? displayedBooks);

  const renderCollectionItem = ({ item, index }: { item: { name: string, count: number }, index: number }) => {
    const isGrid = viewMode === 'grid';
    const color = item.name === 'All Books' ? colors.primary : COLLECTION_COLORS[index % COLLECTION_COLORS.length];
    
    return (
      <TouchableOpacity
        style={isGrid ? styles.gridCard : styles.listCard}
        onPress={() => openCollection(
          item.name === 'All Books' ? '__all__' : (item.name === 'Uncategorised' ? '__uncategorised__' : item.name)
        )}
        onLongPress={() => {
          if (item.name !== 'All Books' && item.name !== 'Uncategorised') {
            setEditingCollection({ name: item.name, index });
            setPickerVisible(true);
          }
        }}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        <View style={[isGrid ? styles.gridIconContainer : styles.listIconContainer, { backgroundColor: color + '15' }]}>
          <DynamicIcon 
            name={item.name === 'All Books' ? 'Library' : (item.name === 'Uncategorised' ? 'Layers' : iconMap[item.name] || 'Layers')} 
            size={isGrid ? 28 : 22} 
            color={color} 
          />
        </View>
        <View style={!isGrid && { flex: 1 }}>
          <Text style={isGrid ? styles.gridName : styles.listName} numberOfLines={1}>{item.name}</Text>
          <Text style={isGrid ? styles.gridCount : styles.listCount}>
            {item.count} {item.count === 1 ? 'book' : 'books'}
          </Text>
        </View>
        {!isGrid && <ChevronRight size={18} color={colors.border} />}
      </TouchableOpacity>
    );
  };

  const renderBook = ({ item }: { item: Book }) => {
    return (
      <TouchableOpacity
        style={styles.bookCard}
        onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
        activeOpacity={0.75}
      >
        <View style={styles.bookCover}>
          <BookIcon size={24} color={colors.primary} />
          <Text style={styles.bookCoverInitial}>{item.title?.[0]}</Text>
        </View>
        <View style={styles.bookInfo}>
          <View style={styles.bookTitleRow}>
            <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
            {profile?.is_admin && (
              <View style={[styles.bookVerifiedPill, item.verified ? styles.bookVerifiedPillOk : styles.bookVerifiedPillPending]}>
                <CheckCircle2 size={14} color={item.verified ? '#1B5E20' : '#8D6E00'} />
              </View>
            )}
          </View>
          <Text style={styles.bookAuthor} numberOfLines={1}>{item.author || 'Unknown Author'}</Text>
          
          <View style={styles.bookMeta}>
            {item.genre ? <Text style={styles.bookGenre}>{item.genre}</Text> : null}
            {item.profiles?.display_name && (
              <Text style={styles.uploaderName}>• {item.profiles.display_name}</Text>
            )}
          </View>
          
          {item.moods?.length > 0 && (
            <View style={styles.moodRow}>
              {item.moods.slice(0, 2).map(m => (
                <View key={m} style={styles.moodChip}>
                  <Text style={styles.moodChipText}>{m}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <ChevronRight size={20} color={colors.border} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} translucent={false} />

      <View style={styles.topBar}>
        <View style={styles.searchInner}>
          <Search size={18} color={isDark ? '#888' : '#AAA'} style={{ marginLeft: 12 }} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder={aiSearchMode ? 'Describe your next adventure...' : 'Search books...'}
            placeholderTextColor={isDark ? '#888' : '#AAA'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={aiSearchMode ? handleAiSearch : undefined}
            returnKeyType={aiSearchMode ? 'search' : 'default'}
          />
          <TouchableOpacity
            style={[styles.aiToggle, aiSearchMode && styles.aiToggleActive]}
            onPress={() => { setAiSearchMode(v => !v); setAiResults(null); setSearchQuery(''); }}
          >
            <Sparkles size={18} color={aiSearchMode ? '#fff' : colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.syncBtn} onPress={() => setSyncModalVisible(true)}>
          <RefreshCw size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.breadcrumbs}>
        {collectionFilter && (
          <TouchableOpacity onPress={openLibraryHome} style={styles.backButton}>
            <ChevronLeft size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          onPress={openLibraryHome}
          style={styles.breadcrumbItem}
        >
          <Text style={[styles.breadcrumbText, isHomeView && styles.breadcrumbActive]}>Library</Text>
        </TouchableOpacity>
        {collectionFilter && (
          <>
            <ChevronRight size={14} color={colors.textSecondary} style={{ marginHorizontal: 4 }} />
            <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
              {isAllView ? 'All Books' : (collectionFilter === '__uncategorised__' ? 'Uncategorised' : collectionFilter)}
            </Text>
          </>
        )}
      </View>

      {aiSearchMode && (
        <View style={styles.aiBar}>
          <Text style={styles.aiHint}>Type a mood, theme or description and tap Search</Text>
          <View style={styles.aiActions}>
            <TouchableOpacity style={styles.aiSearchBtn} onPress={handleAiSearch} disabled={aiSearching}>
              {aiSearching
                ? <ActivityIndicator size="small" color="#fff" />
                : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={14} color="#fff" />
                    <Text style={styles.aiSearchBtnText}>Search</Text>
                  </View>
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

      {loading ? (
        <ActivityIndicator size="large" color="#531492" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={booksToShow}
          keyExtractor={item => item.id}
          renderItem={renderBook}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBooks(); }} tintColor={colors.primary} />}
          ListHeaderComponent={
            <>
              {isHomeView && !aiResults && !searchQuery ? (
                <View style={styles.collectionsSection}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Folders</Text>
                  </View>
                  <View style={[styles.collectionsVertical, viewMode === 'grid' && styles.collectionsGrid]}>
                    <View style={viewMode === 'grid' ? { width: '48%' } : { width: '100%' }}>
                      {renderCollectionItem({ item: { name: 'All Books', count: allBooks.length }, index: -1 })}
                    </View>
                    {collections.map((c, i) => (
                      <View key={c.name} style={viewMode === 'grid' ? { width: '48%' } : { width: '100%' }}>
                        {renderCollectionItem({ item: c, index: i })}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {aiResults && (
                <View style={styles.aiResultsHeader}>
                  <Text style={styles.aiResultsLabel}>✨ AI Results for "{searchQuery}"</Text>
                </View>
              )}
            </>
          }
          ListEmptyComponent={
            (isHomeView && collections.length > 0 && !searchQuery) ? null : (
              <View style={styles.empty}>
                <Inbox size={64} color={colors.border} strokeWidth={1} style={{ marginBottom: 16 }} />
                <Text style={styles.emptyText}>
                  {searchQuery 
                    ? `No matches for "${searchQuery}"` 
                    : isHomeView 
                      ? 'Your library is completely empty' 
                      : isAllView
                        ? 'No books found in your library'
                        : `No books found in "${collectionFilter === '__uncategorised__' ? 'Uncategorised' : collectionFilter}"`
                  }
                </Text>
                {collectionFilter && !searchQuery && (
                  <TouchableOpacity 
                    style={styles.syncRefBtn} 
                    onPress={openLibraryHome}
                  >
                    <Text style={styles.syncRefBtnText}>Back to Library</Text>
                  </TouchableOpacity>
                )}
                {isHomeView && !searchQuery && (
                  <TouchableOpacity style={styles.syncRefBtn} onPress={() => setSyncModalVisible(true)}>
                    <Text style={styles.syncRefBtnText}>Sync Google Drive</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, isUploading && { backgroundColor: '#AAA' }]}
        onPress={() => startUpload(collectionFilter)}
        disabled={isUploading}
      >
        {isUploading ? <ActivityIndicator color="#fff" /> : <Plus size={32} color="#fff" />}
      </TouchableOpacity>

      <SyncModal
        visible={syncModalVisible}
        onClose={() => setSyncModalVisible(false)}
        onSyncComplete={() => { setSyncModalVisible(false); fetchBooks(); }}
      />

      {uploadNode}

      {isUploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.uploadingText}>Uploading & Processing...</Text>
        </View>
      )}

      {/* Icon Picker Modal for collections */}
      <IconPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleIconSelect}
        collectionName={editingCollection?.name || ''}
        currentColor={editingCollection ? COLLECTION_COLORS[editingCollection.index % COLLECTION_COLORS.length] : colors.primary}
      />
    </SafeAreaView>
  );
}

const PURPLE_MAIN = '#531492';
const PINK_ACCENT = '#E80F88';

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(83, 20, 146, 0.75)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100, elevation: 100,
  },
  uploadingText: {
    color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 16
  },
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: 12,
  },
  searchInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg,
    borderRadius: 14, height: 46,
  },
  searchInput: {
    flex: 1, height: '100%', paddingHorizontal: 12,
    fontSize: 15, color: colors.text,
  },
  aiToggle: {
    width: 44, height: 38, borderRadius: 10, marginRight: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  aiToggleActive: { backgroundColor: colors.primary },
  syncBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    justifyContent: 'center', alignItems: 'center',
  },
  breadcrumbs: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: isDark ? colors.background : '#FDFDFD',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backButton: { paddingVertical: 4, marginRight: 8 },
  breadcrumbItem: { paddingVertical: 4 },
  breadcrumbText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  breadcrumbActive: { color: colors.primary, fontWeight: '800' },
  aiBar: {
    backgroundColor: isDark ? 'rgba(187,134,252,0.05)' : '#F7F8FC', 
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  aiHint: { fontSize: 13, color: colors.primary, fontWeight: '500', flex: 1 },
  aiActions: { flexDirection: 'row', gap: 10 },
  aiSearchBtn: {
    backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 20, minWidth: 90, alignItems: 'center',
  },
  aiSearchBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn: {
    backgroundColor: isDark ? '#3A2552' : '#E0E0E0', 
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 20,
  },
  clearBtnText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  aiResultsHeader: { 
    backgroundColor: isDark ? '#1D122B' : '#F5E8FA', 
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    borderRadius: 12, marginBottom: 16,
  },
  aiResultsLabel: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  collectionsSection: { marginBottom: 8 },
  sectionHeader: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    marginBottom: 16, 
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  seeAllText: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  collectionsVertical: { gap: 12 },
  collectionsGrid: { 
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    gap: 0, // Handled by width: 48% and margin
  },
  gridCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  gridIconContainer: {
    width: 60, height: 60,
    borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
  },
  gridName: {
    fontSize: 16, fontWeight: '700', color: colors.text,
    textAlign: 'center', marginBottom: 4,
  },
  gridCount: {
    fontSize: 12, color: colors.textSecondary,
    fontWeight: '600',
  },
  listCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  listIconContainer: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  listName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 },
  listCount: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  bookCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16,
    marginBottom: 12, padding: 12,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  bookCover: {
    width: 60, height: 80, borderRadius: 10, backgroundColor: colors.primary + '11',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
    position: 'relative',
  },
  bookCoverInitial: { 
    position: 'absolute', bottom: 4, right: 6,
    fontSize: 12, fontWeight: '900', color: colors.primary, opacity: 0.3 
  },
  bookInfo: { flex: 1 },
  bookTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  bookTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  bookAuthor: { fontSize: 14, color: colors.textSecondary, marginBottom: 6 },
  bookVerifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 10,
  },
  bookVerifiedPillOk: {
    backgroundColor: '#E8F5E9',
  },
  bookVerifiedPillPending: {
    backgroundColor: '#FFF8E1',
  },
  bookMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  bookGenre: { fontSize: 12, color: colors.primary, fontWeight: '700', backgroundColor: colors.primary + '11', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  uploaderName: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moodChip: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', 
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  moodChipText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase' },
  empty: { alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '500', textAlign: 'center' },
  syncRefBtn: {
    marginTop: 20, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 16,
  },
  syncRefBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  fab: {
    position: 'absolute', bottom: 30, right: 30, width: 64, height: 64,
    borderRadius: 32, backgroundColor: colors.primary, justifyContent: 'center',
    alignItems: 'center', elevation: 8,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12,
  },
});
