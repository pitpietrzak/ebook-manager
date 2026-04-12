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
      <StatusBar barStyle="dark-content" />
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
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); setSyncModalVisible(true); }}>
                <Text style={styles.menuItemIcon}>🔄</Text>
                <Text style={styles.menuItemText}>Sync Library</Text>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#531492" />}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.allBooksCard}
              onPress={() => navigation.navigate('Library', { collectionFilter: null })}
            >
              <View style={[styles.collectionIcon, { backgroundColor: '#53149222' }]}>
                <Text style={[styles.collectionIconText, { color: '#531492' }]}>📚</Text>
              </View>
              <View style={styles.collectionInfo}>
                <Text style={styles.collectionName}>All Books</Text>
                <Text style={styles.collectionCount}>{totalBooks} books</Text>
              </View>
              <Text style={[styles.collectionArrow, { color: '#531492' }]}>›</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FDF8FF' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#EFEFEF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 10,
    zIndex: 10,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#531492' },
  headerSubtitle: { fontSize: 13, color: '#A155B9', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#53149233',
    shadowColor: '#531492',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchText: { fontSize: 15, color: '#999' },
  menuIconBtn: { 
    padding: 4, paddingHorizontal: 12,
    justifyContent: 'center', alignItems: 'center' 
  },
  menuIconText: { fontSize: 24, fontWeight: '700', color: '#531492' },
  dropdownMenu: {
    position: 'absolute', top: 54, right: 0, width: 170,
    backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#531492', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
    zIndex: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: '#F5E8FA',
  },
  menuItem: { 
    flexDirection: 'row', alignItems: 'center', 
    paddingVertical: 16, paddingHorizontal: 16 
  },
  menuItemLogout: { 
    flexDirection: 'row', alignItems: 'center', 
    paddingVertical: 16, paddingHorizontal: 16,
    backgroundColor: '#fff'
  },
  menuItemIcon: { fontSize: 16, marginRight: 12 },
  menuItemText: { fontSize: 15, fontWeight: '700', color: '#531492' },
  menuItemTextLogout: { fontSize: 15, fontWeight: '700', color: '#E53935' },
  menuDivider: { height: 1, backgroundColor: '#F5E8FA' },
  allBooksCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#531492',
    shadowColor: '#531492', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  collectionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 4,
    shadowColor: '#531492', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  collectionIcon: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  collectionIconText: { fontSize: 22, fontWeight: '700' },
  collectionInfo: { flex: 1 },
  collectionName: { fontSize: 17, fontWeight: '600', color: '#1A1A2E' },
  collectionCount: { fontSize: 13, color: '#888', marginTop: 2 },
  collectionArrow: { fontSize: 28, fontWeight: '300' },
  emptyContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
});
