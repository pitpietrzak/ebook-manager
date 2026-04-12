import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { supabase } from '../utils/supabase';
import * as SecureStore from 'expo-secure-store';
import SyncModal from './SyncModal';
import { useBookUpload } from '../hooks/useBookUpload';
import { useTheme } from '../contexts/ThemeContext';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Collections'>;
};

type Collection = {
  name: string;
  count: number;
};

export default function CollectionsScreen({ navigation }: Props) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const { colors, theme, isDark, toggleTheme } = useTheme();
  const styles = getStyles(colors, isDark);

  const { startUpload, isUploading, uploadNode } = useBookUpload(() => fetchCollections());

  const fetchCollections = async () => {
    const { data, error } = await supabase
      .from('books')
      .select('folder_tags');

    if (error || !data) { setLoading(false); setRefreshing(false); return; }

    setTotalBooks(data.length);

    // Count books per tag
    const tagCounts: Record<string, number> = {};
    data.forEach((book: any) => {
      const tags: string[] = book.folder_tags || [];
      if (tags.length === 0) {
        tagCounts['Uncategorised'] = (tagCounts['Uncategorised'] || 0) + 1;
      } else {
        tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    const sorted = Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    setCollections(sorted);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchCollections(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCollections();
  }, []);

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('google_provider_token');
    await supabase.auth.signOut();
  };

  const COLLECTION_COLORS = [
    '#531492', '#7B2CBF', '#9D4EDD', '#C77DFF',
    '#E0AAFF', '#E80F88', '#FF4191', '#FF70A6'
  ];

  const renderCollection = ({ item, index }: { item: Collection; index: number }) => {
    const color = COLLECTION_COLORS[index % COLLECTION_COLORS.length];
    return (
      <TouchableOpacity
        style={[styles.collectionCard, { borderLeftColor: color }]}
        onPress={() => navigation.navigate('Library', {
          collectionFilter: item.name === 'Uncategorised' ? '__uncategorised__' : item.name
        })}
        activeOpacity={0.75}
      >
        <View style={[styles.collectionIcon, { backgroundColor: color + '22' }]}>
          <Text style={[styles.collectionIconText, { color }]}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.collectionInfo}>
          <Text style={styles.collectionName}>{item.name}</Text>
          <Text style={styles.collectionCount}>{item.count} {item.count === 1 ? 'book' : 'books'}</Text>
        </View>
        <Text style={[styles.collectionArrow, { color }]}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Biblioteczka Leniwców 🦥</Text>
          <Text style={styles.headerSubtitle}>{totalBooks} books in your collection</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.menuIconBtn} onPress={() => setMenuVisible(!menuVisible)} activeOpacity={0.7}>
            <Text style={styles.menuIconText}>⋮</Text>
          </TouchableOpacity>
          {menuVisible && (
            <View style={styles.dropdownMenu}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); startUpload(); }}>
                <Text style={styles.menuItemIcon}>📚</Text>
                <Text style={styles.menuItemText}>Upload Book</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setSyncModalVisible(true); }}>
                <Text style={styles.menuItemIcon}>🔄</Text>
                <Text style={styles.menuItemText}>Sync Library</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); toggleTheme(); }}>
                <Text style={styles.menuItemIcon}>{isDark ? '☀️' : '🌙'}</Text>
                <Text style={styles.menuItemText}>{isDark ? 'Light Mode' : 'Dark Mode'}</Text>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItemLogout} onPress={() => { setMenuVisible(false); handleLogout(); }}>
                <Text style={styles.menuItemIcon}>🚪</Text>
                <Text style={styles.menuItemTextLogout}>Logout</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={styles.searchBar}
        onPress={() => navigation.navigate('Library', { collectionFilter: null, autoFocusSearch: true })}
        activeOpacity={0.8}
      >
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchText}>Search titles, authors, or genres...</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#531492" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={collections}
          keyExtractor={(item) => item.name}
          renderItem={renderCollection}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.allBooksCard}
              onPress={() => navigation.navigate('Library', { collectionFilter: null })}
            >
              <View style={[styles.collectionIcon, { backgroundColor: colors.primary + '22' }]}>
                <Text style={[styles.collectionIconText, { color: colors.primary }]}>📚</Text>
              </View>
              <View style={styles.collectionInfo}>
                <Text style={styles.collectionName}>All Books</Text>
                <Text style={styles.collectionCount}>{totalBooks} books</Text>
              </View>
              <Text style={[styles.collectionArrow, { color: colors.primary }]}>›</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>No collections yet</Text>
              <Text style={styles.emptySubtitle}>Tap Sync to import books from your Google Drive</Text>
            </View>
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        />
      )}

      <SyncModal
        visible={syncModalVisible}
        onClose={() => setSyncModalVisible(false)}
        onSyncComplete={() => { setSyncModalVisible(false); fetchCollections(); }}
      />
      {uploadNode}

      {isUploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.uploadingText}>Uploading & Processing Book...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: isDark ? 'rgba(18, 11, 30, 0.9)' : 'rgba(83, 20, 146, 0.75)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 100, elevation: 100,
  },
  uploadingText: {
    color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 16
  },
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: colors.card,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 5,
    zIndex: 10,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.primary },
  headerSubtitle: { fontSize: 13, color: colors.accent, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '33',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchText: { fontSize: 15, color: colors.textSecondary },
  menuIconBtn: {
    padding: 4, paddingHorizontal: 12,
    justifyContent: 'center', alignItems: 'center'
  },
  menuIconText: { fontSize: 24, fontWeight: '700', color: colors.primary },
  dropdownMenu: {
    position: 'absolute', top: 54, right: 0, width: 170,
    backgroundColor: colors.menuBg, borderRadius: 16,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
    zIndex: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 16
  },
  menuItemLogout: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 16,
    backgroundColor: colors.menuBg
  },
  menuItemIcon: { fontSize: 16, marginRight: 12 },
  menuItemText: { fontSize: 15, fontWeight: '700', color: colors.menuItemText },
  menuItemTextLogout: { fontSize: 15, fontWeight: '700', color: '#E53935' },
  menuDivider: { height: 1, backgroundColor: colors.border },
  allBooksCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 14, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  collectionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 4,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  collectionIcon: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  collectionIconText: { fontSize: 22, fontWeight: '700' },
  collectionInfo: { flex: 1 },
  collectionName: { fontSize: 17, fontWeight: '600', color: colors.text },
  collectionCount: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  collectionArrow: { fontSize: 28, fontWeight: '300' },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
});
