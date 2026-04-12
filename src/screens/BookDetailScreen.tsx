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
};

export default function BookDetailScreen({ route }: Props) {
  const { bookId } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showPolish, setShowPolish] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  useEffect(() => {
    fetchBookDetails();
  }, [bookId]);

  const fetchBookDetails = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('books')
      .select('*')
      .eq('id', bookId)
      .single();

    if (!error && data) {
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
        {book.alt_title && (
          <Text style={styles.subtitle}>{book.alt_title}</Text>
        )}
        <Text style={styles.author}>by {book.author}</Text>
        
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
    marginBottom: 20,
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
