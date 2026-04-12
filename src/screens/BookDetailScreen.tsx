import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
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
  title_pl?: string | null;
  author: string;
  genre: string;
  description: string;
  description_pl?: string | null;
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

  const primaryTitle   = book.title;
  const secondaryTitle = book.title_pl;
  const showSecondary  = secondaryTitle && secondaryTitle !== primaryTitle;
  
  const displayDescription = showPolish && book.description_pl ? book.description_pl : book.description;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{primaryTitle}</Text>
        {showSecondary && (
           <Text style={styles.subtitle}>{secondaryTitle}</Text>
        )}
        <Text style={styles.author}>by {book.author}</Text>
        
        <View style={styles.tagsContainer}>
          {book.genre && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{book.genre}</Text>
            </View>
          )}
          {book.moods?.map((mood, idx) => (
            <View key={idx} style={[styles.tag, { backgroundColor: '#e8f4f8' }]}>
              <Text style={[styles.tagText, { color: '#0083B0' }]}>{mood}</Text>
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
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 18,
    color: '#888',
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
    backgroundColor: '#f0e6fa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    color: '#9b59b6',
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
    color: '#4285F4',
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
    backgroundColor: '#4285F4',
    padding: 16,
    borderRadius: 8,
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
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4285F4',
  },
  secondaryButtonText: {
    color: '#4285F4',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
