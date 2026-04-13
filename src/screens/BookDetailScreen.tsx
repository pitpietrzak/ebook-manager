import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { StatusBar } from 'react-native';

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

export default function BookDetailScreen({ route }: Props) {
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
      <View style={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
        {book.alt_title && <Text style={styles.subtitle}>{book.alt_title}</Text>}
        <Text style={styles.author}>by {book.author}</Text>

        <View style={styles.metaRow}>
          {book.profiles?.display_name && (
            <Text style={styles.uploader}>Added by {book.profiles.display_name}</Text>
          )}
        </View>

        <View style={styles.ratingSection}>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity key={s} onPress={() => handleRate(s)}>
                <Text style={[styles.star, s <= (userRating || 0) && styles.starActive]}>
                  {s <= (userRating || 0) ? '★' : '☆'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {avgRating !== null && (
            <Text style={styles.avgRating}>
              {avgRating.toFixed(1)} ({ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'})
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
          <Text style={styles.sectionTitle}>Description</Text>
          {book.description_pl && (
            <TouchableOpacity onPress={() => setShowPolish(!showPolish)}>
              <Text style={styles.translateText}>
                {showPolish ? 'View in English' : 'Translate to Polish'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.description}>{displayDescription}</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryButton} onPress={() => {/* Download or open logic */}}>
            <Text style={styles.buttonText}>Download / Open</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.secondaryButton} 
            onPress={handleSendToKindle}
            disabled={sendingEmail}
          >
            <Text style={styles.secondaryButtonText}>
              {sendingEmail ? 'Sending...' : 'Send to Kindle'}
            </Text>
          </TouchableOpacity>

          {book.goodreads_url ? (
            <TouchableOpacity 
              style={[styles.secondaryButton, { borderColor: isDark ? '#82713D' : '#E9E5CE' }]} 
              onPress={() => Linking.openURL(book.goodreads_url!)}
            >
              <Text style={[styles.secondaryButtonText, { color: isDark ? '#D9C587' : '#82713D' }]}>📚 Open in Goodreads</Text>
            </TouchableOpacity>
          ) : null}

          {book.lubimyczytac_url ? (
            <TouchableOpacity 
              style={[styles.secondaryButton, { borderColor: isDark ? '#D32F2F' : '#F5E8E8' }]} 
              onPress={() => Linking.openURL(book.lubimyczytac_url!)}
            >
              <Text style={[styles.secondaryButtonText, { color: isDark ? '#FF8A80' : '#D32F2F' }]}>📖 Open in LubimyCzytać</Text>
            </TouchableOpacity>
          ) : null}
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
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 18,
    color: colors.accent,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  author: {
    fontSize: 18,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 12,
  },
  uploader: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  ratingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    backgroundColor: isDark ? '#1D122B' : '#F7F8FC',
    padding: 12,
    borderRadius: 12,
  },
  stars: {
    flexDirection: 'row',
    gap: 4,
  },
  star: {
    fontSize: 24,
    color: isDark ? '#3A2552' : '#DDD',
  },
  starActive: {
    color: '#FFD700',
  },
  avgRating: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  tag: {
    backgroundColor: isDark ? '#3A2552' : '#F5E8FA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    color: isDark ? '#E9D5FF' : '#71229F',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  descriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 10,
    marginBottom: 10,
  },
  translateText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  actions: {
    marginTop: 40,
    gap: 15,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: 'bold',
  }
});
