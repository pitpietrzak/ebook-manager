import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar, SafeAreaView, ScrollView, Dimensions
} from 'react-native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../../App';
import { getSortedCollections } from '../utils/collections';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';
import DynamicIcon from '../components/DynamicIcon';
import { LayoutGrid, List as ListIcon, Star, MessageCircle } from 'lucide-react-native';

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

type Book = {
  id: string;
  title: string;
  author: string;
};

type Reaction = {
  book_id: string;
  review?: string | null;
  rating: number;
  created_at: string;
  bookTitle: string;
  author: string;
};

export default function DashboardScreen({ navigation }: Props) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [recentBooks, setRecentBooks] = useState<Book[]>([]);
  const [recentReactions, setRecentReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);

    const { data: booksData } = await supabase.from('books').select('*');
    const sortedCollections: Collection[] = getSortedCollections((booksData || []) as { folder_tags?: string[] | null }[]);
    setCollections(sortedCollections);

    const { data: recent } = await supabase
      .from('books')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    setRecentBooks(recent || []);

    const { data: latestRatings } = await supabase
      .from('book_ratings')
      .select('book_id, review, rating, created_at')
      .order('created_at', { ascending: false })
      .limit(3);

    if (latestRatings?.length) {
      const bookIds = latestRatings.map(item => item.book_id);
      const { data: books } = await supabase
        .from('books')
        .select('id, title, author')
        .in('id', bookIds);

      const bookMap = Object.fromEntries((books || []).map(book => [book.id, book]));
      setRecentReactions(
        latestRatings.map(item => ({
          ...item,
          bookTitle: bookMap[item.book_id]?.title || 'Unknown book',
          author: bookMap[item.book_id]?.author || 'Unknown author',
        }))
      );
    } else {
      setRecentReactions([]);
    }

    setLoading(false);
  };

  const renderCollectionCard = ({ item }: { item: Collection; index: number }) => {
    const color = colors.primary;
    return (
      <TouchableOpacity
        style={viewMode === 'grid' ? styles.gridCard : styles.listCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Library', { collectionFilter: item.name === 'Uncategorised' ? '__uncategorised__' : item.name })}
      >
        <View style={[viewMode === 'grid' ? styles.gridIconContainer : styles.listIconContainer, { backgroundColor: color + '15' }]}> 
          <DynamicIcon name={item.name === 'Uncategorised' ? 'Layers' : 'Library'} size={viewMode === 'grid' ? 28 : 22} color={color} />
        </View>
        <View style={viewMode === 'grid' ? null : { flex: 1 }}>
          <Text style={viewMode === 'grid' ? styles.gridName : styles.listName} numberOfLines={1}>{item.name}</Text>
          <Text style={viewMode === 'grid' ? styles.gridCount : styles.listCount}>{item.count} {item.count === 1 ? 'book' : 'books'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Dashboard</Text>
        </View>

        <Text style={styles.sectionTitle}>Most Recent Books</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll} contentContainerStyle={{ paddingLeft: 16, paddingRight: 8 }}>
          {recentBooks.map((book, i) => (
            <TouchableOpacity
              key={book.id}
              style={styles.recentBookCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('BookDetail', { bookId: book.id })}
            >
              <View style={[styles.bookCover, { backgroundColor: colors.primary + '11' }]}> 
                <Text style={styles.bookCoverInitial}>{book.title?.[0]}</Text>
              </View>
              <Text style={styles.recentBookTitle} numberOfLines={1}>{book.title}</Text>
              <Text style={styles.recentBookAuthor} numberOfLines={1}>{book.author}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>Recent Reactions</Text>
        {recentReactions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalScroll}
            contentContainerStyle={{ paddingLeft: 16, paddingRight: 8 }}
          >
            {recentReactions.map((reaction) => (
              <TouchableOpacity
                key={`${reaction.book_id}-${reaction.created_at}`}
                style={styles.reviewCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('BookDetail', { bookId: reaction.book_id })}
              >
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewIconWrap}>
                    <MessageCircle size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewBookTitle} numberOfLines={1}>{reaction.bookTitle}</Text>
                    <Text style={styles.reviewAuthor} numberOfLines={1}>{reaction.author}</Text>
                  </View>
                </View>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star
                      key={star}
                      size={14}
                      fill={star <= reaction.rating ? '#FFD166' : 'transparent'}
                      color={star <= reaction.rating ? '#FFD166' : colors.border}
                    />
                  ))}
                </View>
                <Text style={styles.reviewText} numberOfLines={3}>
                  {reaction.review?.trim()
                    ? `“${reaction.review}”`
                    : `A fresh ${reaction.rating}-star reaction just landed for this book.`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyReviewCard}>
            <MessageCircle size={18} color={colors.textSecondary} />
            <Text style={styles.emptyReviewText}>No ratings yet</Text>
          </View>
        )}

        <View style={styles.collectionsHeaderRow}>
          <Text style={styles.sectionTitleNoMargin}>Collections</Text>
          <View style={styles.toggleRow}>
            <TouchableOpacity style={[styles.toggleBtn, viewMode === 'grid' && styles.toggleActive]} onPress={() => setViewMode('grid')}>
              <LayoutGrid size={20} color={viewMode === 'grid' ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, viewMode === 'list' && styles.toggleActive]} onPress={() => setViewMode('list')}>
              <ListIcon size={20} color={viewMode === 'list' ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.collectionsWrap, viewMode === 'grid' && styles.collectionsGrid]}>
          {collections.map((item, index) => (
            <View key={item.name} style={viewMode === 'grid' ? styles.gridItemWrap : undefined}>
              {renderCollectionCard({ item, index })}
            </View>
          ))}
        </View>
      </ScrollView>
      {loading && <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={colors.primary} /></View>}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: { padding: 8, borderRadius: 10 },
  toggleActive: { backgroundColor: colors.primary + '11' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginLeft: 16, marginTop: 24, marginBottom: 12 },
  sectionTitleNoMargin: { fontSize: 18, fontWeight: '800', color: colors.text },
  collectionsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  horizontalScroll: { marginBottom: 8 },
  recentBookCard: {
    width: 120, marginRight: 16, backgroundColor: colors.card, borderRadius: 18, padding: 12, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  bookCover: {
    width: 56, height: 76, borderRadius: 12, backgroundColor: colors.primary + '11', justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  bookCoverInitial: { fontSize: 22, fontWeight: '900', color: colors.primary, opacity: 0.3 },
  recentBookTitle: { fontSize: 14, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 2 },
  recentBookAuthor: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  reviewCard: {
    width: 280,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    marginRight: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  reviewIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary + '12',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewBookTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  reviewAuthor: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  reviewStars: { flexDirection: 'row', gap: 2 },
  reviewText: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  emptyReviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyReviewText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  collectionsWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  collectionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItemWrap: {
    width: '48%',
  },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  gridCard: {
    backgroundColor: colors.card, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, flex: 1, marginHorizontal: 4,
    minWidth: (Dimensions.get('window').width - 48) / 2, maxWidth: (Dimensions.get('window').width - 48) / 2,
  },
  gridIconContainer: {
    width: 60, height: 60, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  gridName: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 4 },
  gridCount: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  listCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  listIconContainer: {
    width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  listName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 },
  listCount: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background + 'CC', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
});
