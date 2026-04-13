import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView
} from 'react-native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../../App';
import { supabase } from '../utils/supabase';
import * as SecureStore from 'expo-secure-store';
import SyncModal from './SyncModal';
import NotificationModal from '../components/NotificationModal';
import IconPickerModal from '../components/IconPickerModal';
import { useBookUpload } from '../hooks/useBookUpload';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/ProfileContext';
import DynamicIcon from '../components/DynamicIcon';
import { 
  Search, Plus, RefreshCw, Bell, ChevronRight, Layers, 
  Library, MoreVertical, Settings, User as UserIcon
} from 'lucide-react-native';

type Props = {
  navigation: CompositeNavigationProp<
    BottomTabNavigationProp<TabParamList, 'Dashboard'>,
    NativeStackNavigationProp<RootStackParamList>
  >;
};

type Collection = {
  name: string;
  count: number;
};

export default function CollectionsScreen({ navigation }: Props) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [iconMap, setIconMap] = useState<Record<string, string>>({});
  const [totalBooks, setTotalBooks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editingCollection, setEditingCollection] = useState<{ name: string; index: number } | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const { colors, theme, isDark, toggleTheme, viewMode } = useTheme();
  const { profile, updateDisplayName } = useProfile();
  const styles = getStyles(colors, isDark);
  
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    fetchUnreadCount();
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);
      if (count !== null) setUnreadNotifications(count);
    } catch (e) {
      console.warn('Unread count fetch failed (migration might be missing):', e);
    }
  };

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

    // Fetch or suggest icons for each collection
    fetchCollectionIcons(sorted.map(c => c.name));
  };

  const fetchCollectionIcons = async (names: string[]) => {
    try {
      // 1. Get existing icons from DB
      const { data, error } = await supabase
        .from('collection_icons')
        .select('name, icon_name')
        .in('name', names);
      
      if (error) throw error;

      const newMap = { ...iconMap };
      data?.forEach(row => {
        newMap[row.name] = row.icon_name;
      });
      setIconMap(newMap);

      // 2. For missing ones, trigger AI suggestion (sequentially to avoid overwhelming)
      const missing = names.filter(name => !newMap[name] && name !== 'Uncategorised');
      
      for (const name of missing) {
        try {
          const { data: aiData, error: aiError } = await supabase.functions.invoke('suggest-icon', {
            body: { name }
          });
          if (aiData?.icon_name) {
            setIconMap(prev => ({ ...prev, [name]: aiData.icon_name }));
          }
        } catch (e) {
          console.error(`Failed to get icon for ${name}:`, e);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch collection icons:', e);
    }
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
    '#8B5CF6', '#D946EF', '#F43F5E', '#6366F1',
    '#EC4899', '#3B82F6', '#06B6D4', '#10B981'
  ];

  const handleIconSelect = async (iconName: string) => {
    if (!editingCollection) return;
    
    const { name } = editingCollection;
    
    // 1. Update local state immediately
    setIconMap(prev => ({ ...prev, [name]: iconName }));
    setPickerVisible(false);

    // 2. Persist to DB
    try {
      const { error } = await supabase
        .from('collection_icons')
        .upsert({ name, icon_name: iconName });
      
      if (error) throw error;
    } catch (e) {
      console.error('Failed to save icon:', e);
      // Optional: rollback on error if you prefer
    }
  };

  const renderCollection = ({ item, index }: { item: Collection; index: number }) => {
    const isGrid = viewMode === 'grid';
    const color = COLLECTION_COLORS[index % COLLECTION_COLORS.length];
    
    return (
      <TouchableOpacity
        style={isGrid ? styles.gridCard : styles.listCard}
        onPress={() => navigation.navigate('Library', {
          collectionFilter: item.name === 'Uncategorised' ? '__uncategorised__' : item.name
        })}
        onLongPress={() => {
          if (item.name !== 'Uncategorised') {
            setEditingCollection({ name: item.name, index });
            setPickerVisible(true);
          }
        }}
        delayLongPress={300}
        activeOpacity={0.75}
      >
        <View style={[isGrid ? styles.gridIconContainer : styles.listIconContainer, { backgroundColor: color + '20' }]}>
          <DynamicIcon 
            name={item.name === 'Uncategorised' ? 'Layers' : iconMap[item.name] || 'Layers'} 
            size={isGrid ? 28 : 22} 
            color={color} 
          />
        </View>
        <View style={!isGrid && styles.listInfo}>
          <Text style={isGrid ? styles.gridName : styles.listName} numberOfLines={1}>{item.name}</Text>
          <Text style={isGrid ? styles.gridCount : styles.listCount}>{item.count} {item.count === 1 ? 'book' : 'books'}</Text>
        </View>
        {!isGrid && <ChevronRight size={18} color={colors.border} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} />
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Text 
            style={styles.headerTitle} 
            numberOfLines={1} 
            adjustsFontSizeToFit={true}
            minimumFontScale={0.7}
          >
            Biblioteczka Leniwców
          </Text>
          <Text style={styles.headerSubtitle}>{totalBooks} books in your collection</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setNotificationsVisible(true)}>
            <Bell size={24} color={colors.primary} />
            {unreadNotifications > 0 && <View style={styles.badge} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSyncModalVisible(true)}>
            <RefreshCw size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.searchBar}
        onPress={() => navigation.navigate('Library', { collectionFilter: null, autoFocusSearch: true })}
        activeOpacity={0.8}
      >
        <Search size={20} color={colors.textSecondary} style={{ marginRight: 10 }} />
        <Text style={styles.searchText}>Find your favorite stories...</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#531492" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          key={viewMode}
          data={collections}
          keyExtractor={(item) => item.name}
          renderItem={renderCollection}
          numColumns={viewMode === 'grid' ? 2 : 1}
          columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.allBooksCard}
              onPress={() => navigation.navigate('Library', { collectionFilter: null })}
            >
              <View style={[styles.allBooksIcon, { backgroundColor: colors.primary + '22' }]}>
                <Library size={32} color={colors.primary} />
              </View>
              <View style={styles.allBooksInfo}>
                <Text style={styles.allBooksTitle}>All Books</Text>
                <Text style={styles.allBooksSubtitle}>{totalBooks} books available</Text>
              </View>
              <ChevronRight size={24} color={colors.primary} />
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Library size={64} color={colors.border} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>Your library is quiet</Text>
              <Text style={styles.emptySubtitle}>Sync your Google Drive to see your collections appear here.</Text>
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
      <NotificationModal 
        visible={notificationsVisible} 
        onClose={() => { setNotificationsVisible(false); fetchUnreadCount(); }}
        onSelectBook={(bookId) => navigation.navigate('BookDetail', { bookId })}
      />

      <IconPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleIconSelect}
        collectionName={editingCollection?.name || ''}
        currentColor={editingCollection ? COLLECTION_COLORS[editingCollection.index % COLLECTION_COLORS.length] : colors.primary}
      />
      
      <TouchableOpacity 
        style={styles.fab} 
        onPress={() => startUpload()}
        activeOpacity={0.8}
      >
        <Plus size={32} color="#FFFFFF" />
      </TouchableOpacity>

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
  headerTitleContainer: {
    flex: 1,
    marginRight: 10,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.primary },
  headerSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 99,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchText: { fontSize: 15, color: colors.textSecondary, fontWeight: '500' },
  badge: {
    position: 'absolute', top: 6, right: 6, width: 8, height: 8,
    borderRadius: 4, backgroundColor: colors.accent,
    borderWidth: 1.5, borderColor: colors.card,
  },
  allBooksCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 20, padding: 20, marginHorizontal: 4, marginBottom: 20,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
  },
  allBooksIcon: {
    width: 64, height: 64, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  allBooksInfo: { flex: 1 },
  allBooksTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  allBooksSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  gridRow: {
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  gridCard: {
    width: '48%',
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
  listInfo: { flex: 1 },
  listName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 },
  listCount: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  emptyContainer: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
});
