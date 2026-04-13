import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { StatusBar } from 'react-native';
import { 
  Star, User, Calendar, ChevronLeft, Share2, 
  ExternalLink, Languages, Book, Clock, Download, Mail
} from 'lucide-react-native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BookDetail'>;
  route: RouteProp<RootStackParamList, 'BookDetail'>;
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
  moods: string[];
  user_id: string;
  profiles?: { display_name: string } | null;
};

export default function BookDetailScreen({ navigation, route }: Props) {
  const { bookId } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showPolish, setShowPolish] = useState(false);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  useEffect(() => {
    fetchBookDetails();
    fetchRatings();
  }, [bookId]);

  const fetchRatings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('book_ratings')
          .select('rating')
          .eq('book_id', bookId)
          .eq('user_id', user.id)
          .single();
        if (data) setUserRating(data.rating);
      }

      const { data: allRatings } = await supabase
        .from('book_ratings')
        .select('rating')
        .eq('book_id', bookId);

      if (allRatings && allRatings.length > 0) {
        const total = allRatings.reduce((sum, r) => sum + r.rating, 0);
        setAvgRating(total / allRatings.length);
        setRatingCount(allRatings.length);
      }
    } catch (e) {
      console.warn('Ratings fetch failed:', e);
    }
  };

  const handleRate = async (rating: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Login required', 'Please log in to rate books.');
        return;
      }

      const { error } = await supabase
        .from('book_ratings')
        .upsert({
          book_id: bookId,
          user_id: user.id,
          rating
        }, { onConflict: 'user_id,book_id' });

      if (error) throw error;
      setUserRating(rating);
      fetchRatings();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const fetchBookDetails = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('books')
      .select('*, profiles(display_name)')
      .eq('id', bookId)
      .single();

    if (error) {
      console.warn('Profile join failed in detail view:', error.message);
      const { data: fallbackData } = await supabase
        .from('books')
        .select('*')
        .eq('id', bookId)
        .single();
      if (fallbackData) setBook(fallbackData);
    } else if (data) {
      setBook(data);
    }
    setLoading(false);
  };

  const handleSendToKindle = async () => {
    // Show prompt for email, or retrieve from user settings
    // Call Supabase Edge Function to download from GDrive & send via Brevo
    setSendingEmail(true);
    const { error } = await supabase.functions.invoke('send-to-kindle', {
      body: { bookId, email: 'example@kindle.com' } // Hardcoded for now
    });
    
    setSendingEmail(false);
    if (error) {
      Alert.alert('Error', 'Could not send to Kindle.');
    } else {
      Alert.alert('Success', 'Book sent to your Kindle!');
    }
  };

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 50 }} size="large" color={colors.primary} />;
  }

  if (!book) {
    return (
      <View style={styles.container}>
        <Text style={{ color: colors.text }}>Book not found.</Text>
      </View>
    );
  }

  const displayDescription = showPolish && book.description_pl ? book.description_pl : book.description;

  return (
    <ScrollView style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.shareBtn}>
          <Share2 size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
        {book.alt_title && <Text style={styles.subtitle}>{book.alt_title}</Text>}
        <Text style={styles.author}>by {book.author}</Text>

        <View style={styles.metaRow}>
          {book.profiles?.display_name && (
            <View style={styles.uploaderRow}>
              <User size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text style={styles.uploader}>Added by {book.profiles.display_name}</Text>
            </View>
          )}
        </View>

        <View style={styles.ratingSection}>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity key={s} onPress={() => handleRate(s)}>
                <Star 
                  size={24} 
                  fill={s <= (userRating || 0) ? '#FFD700' : 'transparent'} 
                  color={s <= (userRating || 0) ? '#FFD700' : isDark ? '#3A2552' : '#DDD'} 
                />
              </TouchableOpacity>
            ))}
          </View>
          {avgRating !== null && (
            <Text style={styles.avgRating}>
              {avgRating.toFixed(1)} <Text style={{ fontSize: 12, fontWeight: '400' }}>({ratingCount} reviews)</Text>
            </Text>
          )}
        </View>

        <View style={styles.tagsContainer}>
          {book.genre && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{book.genre}</Text>
            </View>
          )}
          {book.moods?.map((mood, idx) => (
            <View key={idx} style={styles.tag}>
              <Text style={styles.tagText}>{mood}</Text>
            </View>
          ))}
        </View>

        <View style={styles.descriptionHeader}>
          <Text style={styles.sectionTitle}>About this book</Text>
          {book.description_pl && (
            <TouchableOpacity style={styles.translateBtn} onPress={() => setShowPolish(!showPolish)}>
              <Languages size={14} color={colors.accent} style={{ marginRight: 6 }} />
              <Text style={styles.translateText}>
                {showPolish ? 'English' : 'Polish'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.description}>{displayDescription}</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryButton} onPress={() => {/* Download or open logic */}}>
            <Download size={20} color="#fff" style={{ marginRight: 10 }} />
            <Text style={styles.buttonText}>Download / Open</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.secondaryButton} 
            onPress={handleSendToKindle}
            disabled={sendingEmail}
          >
            <Mail size={20} color={colors.accent} style={{ marginRight: 10 }} />
            <Text style={styles.secondaryButtonText}>
              {sendingEmail ? 'Sending...' : 'Send to Kindle'}
            </Text>
          </TouchableOpacity>

          <View style={styles.externalLinksRow}>
            {book.goodreads_url ? (
              <TouchableOpacity 
                style={[styles.linkPill, { backgroundColor: '#E9E5CE' }]} 
                onPress={() => Linking.openURL(book.goodreads_url!)}
              >
                <ExternalLink size={14} color="#82713D" />
                <Text style={[styles.linkPillText, { color: '#82713D' }]}>Goodreads</Text>
              </TouchableOpacity>
            ) : null}

            {book.lubimyczytac_url ? (
              <TouchableOpacity 
                style={[styles.linkPill, { backgroundColor: '#F5E8E8' }]} 
                onPress={() => Linking.openURL(book.lubimyczytac_url!)}
              >
                <ExternalLink size={14} color="#D32F2F" />
                <Text style={[styles.linkPillText, { color: '#D32F2F' }]}>LubimyCzytać</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    padding: 8, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
  },
  shareBtn: {
    padding: 8, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
  },
  content: {
    padding: 24, paddingTop: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary,
    marginBottom: 8,
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 18,
    color: colors.accent,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  author: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  uploaderRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  uploader: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600'
  },
  ratingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  stars: {
    flexDirection: 'row',
    gap: 6,
  },
  avgRating: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '700',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  tag: {
    backgroundColor: colors.primary + '11',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  tagText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  descriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  translateBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.accent + '11',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  translateText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  description: {
    fontSize: 16,
    lineHeight: 26,
    color: colors.textSecondary,
    marginBottom: 40,
  },
  actions: {
    gap: 16,
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 12, elevation: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    paddingVertical: 18,
    borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: 'bold',
  },
  externalLinksRow: {
    flexDirection: 'row', gap: 12, marginTop: 8,
  },
  linkPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 14, gap: 8,
  },
  linkPillText: {
    fontSize: 13, fontWeight: '700',
  }
});
