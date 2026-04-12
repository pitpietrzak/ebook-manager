import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { supabase } from '../utils/supabase';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BookDetail'>;
  route: RouteProp<RootStackParamList, 'BookDetail'>;
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
};

export default function BookDetailScreen({ route }: Props) {
  const { bookId } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showPolish, setShowPolish] = useState(false);

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
    return <ActivityIndicator style={{ marginTop: 50 }} size="large" />;
  }

  if (!book) {
    return (
      <View style={styles.container}>
        <Text>Book not found.</Text>
      </View>
    );
  }

  const displayDescription = showPolish && book.description_pl ? book.description_pl : book.description;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
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
              style={[styles.secondaryButton, { borderColor: '#E9E5CE' }]} 
              onPress={() => Linking.openURL(book.goodreads_url!)}
            >
              <Text style={[styles.secondaryButtonText, { color: '#82713D' }]}>📚 Open in Goodreads</Text>
            </TouchableOpacity>
          ) : null}

          {book.lubimyczytac_url ? (
            <TouchableOpacity 
              style={[styles.secondaryButton, { borderColor: '#F5E8E8' }]} 
              onPress={() => Linking.openURL(book.lubimyczytac_url!)}
            >
              <Text style={[styles.secondaryButtonText, { color: '#D32F2F' }]}>📖 Open in LubimyCzytać</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const PURPLE_MAIN = '#531492';
const PINK_ACCENT = '#E80F88';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF8FF',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: PURPLE_MAIN,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 18,
    color: '#A155B9',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  author: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  tag: {
    backgroundColor: '#F5E8FA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    color: '#71229F',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  descriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 10,
    marginBottom: 10,
  },
  translateText: {
    color: PINK_ACCENT,
    fontSize: 14,
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
  },
  actions: {
    marginTop: 40,
    gap: 15,
  },
  primaryButton: {
    backgroundColor: PURPLE_MAIN,
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
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PINK_ACCENT,
  },
  secondaryButtonText: {
    color: PINK_ACCENT,
    fontSize: 16,
    fontWeight: 'bold',
  }
});
