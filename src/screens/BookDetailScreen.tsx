import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking, TextInput } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import InputModal from '../components/InputModal';
import { supabase } from '../utils/supabase';
import { getValidGoogleAccessToken, isGoogleAuthError } from '../utils/googleAuth';
import { invokeEdgeFunctionWithRetry } from '../utils/supabaseFunctions';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/ProfileContext';
import { StatusBar } from 'react-native';
import { 
  Star, User, ChevronLeft, ChevronDown, ChevronUp,
  ExternalLink, Languages, Mail
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
  const [userReview, setUserReview] = useState('');
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportLinkType, setReportLinkType] = useState<'goodreads' | 'lubimyczytac' | null>(null);
  const [reportCurrentUrl, setReportCurrentUrl] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const { colors, isDark } = useTheme();
  const { profile } = useProfile();
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
          .select('rating, review')
          .eq('book_id', bookId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (data) {
          setUserRating(data.rating);
          setUserReview(data.review || '');
        }
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
          rating,
          review: userReview.trim() || null,
        }, { onConflict: 'user_id,book_id' });

      if (error) throw error;
      setUserRating(rating);
      fetchRatings();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleSaveReview = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Login required', 'Please log in to save your rating or note.');
        return;
      }

      if (!userRating) {
        Alert.alert('Pick a rating', 'Choose a star rating before saving your note.');
        return;
      }

      setSavingReview(true);
      const { error } = await supabase
        .from('book_ratings')
        .upsert({
          book_id: bookId,
          user_id: user.id,
          rating: userRating,
          review: userReview.trim() || null,
        }, { onConflict: 'user_id,book_id' });

      if (error) throw error;
      fetchRatings();
      Alert.alert('Saved', userReview.trim() ? 'Your review was saved.' : 'Your rating was updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingReview(false);
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

  const handleOpenExternalUrl = async (url: string, label: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('Invalid link', `Could not open ${label} link.`);
        return;
      }
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert('Link error', error?.message || `Could not open ${label} link.`);
    }
  };

  const handleSendToKindle = async () => {
    if (!profile?.kindle_email) {
      Alert.alert(
        'Kindle Email Missing',
        'Please set your Kindle email in your Profile settings first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Profile', onPress: () => navigation.navigate('Main' as any, { screen: 'Profile' }) }
        ]
      );
      return;
    }

    const getFriendlyKindleError = (rawMessage?: string) => {
      const message = (rawMessage || '').toLowerCase();

      if (message.includes('too large') || message.includes('memory limit')) {
        return {
          title: 'File too large',
          body: 'This book is too large to send from the app. Please download it and send it to Kindle manually.'
        };
      }

      if (message.includes('session') || message.includes('token') || message.includes('unauthorized')) {
        return {
          title: 'Session expired',
          body: 'Please log in again and try sending the book one more time.'
        };
      }

      if (message.includes('gmail api')) {
        return {
          title: 'Unable to send right now',
          body: 'Gmail could not process this request at the moment. Please try again in a little while.'
        };
      }

      return {
        title: 'Unable to send to Kindle',
        body: rawMessage || 'Something went wrong while sending this book. Please try again in a moment.'
      };
    };

    const extractKindleErrorMessage = async (errorObj?: any, responseData?: any) => {
      if (typeof responseData?.error === 'string' && responseData.error.trim()) {
        return responseData.error;
      }

      if (errorObj?.context) {
        try {
          const contextData = await errorObj.context.json();
          if (typeof contextData?.error === 'string' && contextData.error.trim()) {
            return contextData.error;
          }
        } catch {}
      }

      return errorObj?.message || 'Something went wrong while sending this book. Please try again in a moment.';
    };

    setSendingEmail(true);
    try {
      const invokeSendToKindle = async (providerToken: string) => {
        return invokeEdgeFunctionWithRetry<{ success?: boolean; error?: string }>('send-to-kindle', {
          body: {
            bookId,
            email: profile.kindle_email,
            providerToken,
          },
        });
      };

      let providerToken = await getValidGoogleAccessToken();
      let { data, error } = await invokeSendToKindle(providerToken);
      let errorMsg = await extractKindleErrorMessage(error, data);

      if ((error || data?.error || !data?.success) && isGoogleAuthError(errorMsg)) {
        providerToken = await getValidGoogleAccessToken({ forceRefresh: true });
        ({ data, error } = await invokeSendToKindle(providerToken));
        errorMsg = await extractKindleErrorMessage(error, data);
      }

      if (error || data?.error || !data?.success) {
        const friendly = getFriendlyKindleError(errorMsg);
        Alert.alert(friendly.title, friendly.body);
        return;
      }

      Alert.alert('Success', 'Book sent to your Kindle!');
    } catch (e: any) {
      const errorMsg = await extractKindleErrorMessage(e);
      const friendly = getFriendlyKindleError(errorMsg);
      Alert.alert(friendly.title, friendly.body);
    } finally {
      setSendingEmail(false);
    }
  };

  const openReportModal = (linkType: 'goodreads' | 'lubimyczytac', currentUrl: string | null) => {
    setReportLinkType(linkType);
    setReportCurrentUrl(currentUrl);
    setReportModalVisible(true);
  };

  const isUrlAllowedForType = (rawUrl: string, linkType: 'goodreads' | 'lubimyczytac') => {
    try {
      const parsed = new URL(rawUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) return false;
      const host = parsed.hostname.toLowerCase();
      if (linkType === 'goodreads') return host.includes('goodreads.com');
      return host.includes('lubimyczytac.pl');
    } catch {
      return false;
    }
  };

  const handleSaveReportedUrl = async (value: string) => {
    if (!book || !reportLinkType) {
      setReportModalVisible(false);
      return;
    }

    const proposedUrl = value.trim();
    if (!proposedUrl) {
      Alert.alert('Missing URL', 'Please paste the correct URL first.');
      return;
    }

    if (!isUrlAllowedForType(proposedUrl, reportLinkType)) {
      const hostLabel = reportLinkType === 'goodreads' ? 'goodreads.com' : 'lubimyczytac.pl';
      Alert.alert('Invalid URL', `Please provide a valid ${hostLabel} link.`);
      return;
    }

    try {
      setReportSubmitting(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Login required', 'Please log in to report wrong links.');
        return;
      }

      const { error } = await supabase
        .from('book_link_reports')
        .insert({
          book_id: book.id,
          reporter_user_id: user.id,
          link_type: reportLinkType,
          current_url: reportCurrentUrl,
          proposed_url: proposedUrl,
          reason: null,
        });

      if (error) throw error;

      setReportModalVisible(false);
      setReportLinkType(null);
      setReportCurrentUrl(null);
      Alert.alert('Report sent', 'Thanks. Admin will review this correction.');
    } catch (e: any) {
      Alert.alert('Failed to submit', e?.message || 'Could not submit your report. Please try again.');
    } finally {
      setReportSubmitting(false);
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
    <>
    <ScrollView style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.headerBg} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ width: 40 }} />
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
          <TouchableOpacity
            style={styles.ratingHeaderBtn}
            activeOpacity={0.8}
            onPress={() => setReviewExpanded(v => !v)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Rate this book</Text>
              <Text style={styles.reviewHint}>Tap to {reviewExpanded ? 'hide' : 'add'} your rating and optional note</Text>
            </View>
            <View style={styles.ratingHeaderRight}>
              {avgRating !== null && (
                <Text style={styles.avgRating}>
                  {avgRating.toFixed(1)} <Text style={{ fontSize: 12, fontWeight: '400' }}>({ratingCount} ratings)</Text>
                </Text>
              )}
              {reviewExpanded ? <ChevronUp size={18} color={colors.textSecondary} /> : <ChevronDown size={18} color={colors.textSecondary} />}
            </View>
          </TouchableOpacity>

          {reviewExpanded && (
            <>
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

              <TextInput
                style={styles.reviewInput}
                placeholder="What did you think?"
                placeholderTextColor={colors.textSecondary}
                value={userReview}
                onChangeText={setUserReview}
                multiline
                textAlignVertical="top"
                maxLength={300}
              />
              <TouchableOpacity
                style={[styles.saveReviewBtn, savingReview && { opacity: 0.7 }]}
                onPress={handleSaveReview}
                disabled={savingReview}
              >
                <Text style={styles.saveReviewText}>{savingReview ? 'Saving...' : 'Save rating & note'}</Text>
              </TouchableOpacity>
            </>
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

          <View style={styles.linkRows}>
            <View style={styles.linkActionRow}>
              <TouchableOpacity
                style={[
                  styles.linkPill,
                  { backgroundColor: '#E9E5CE' },
                  !book.goodreads_url && styles.linkPillDisabled,
                ]}
                onPress={() => {
                  if (book.goodreads_url) handleOpenExternalUrl(book.goodreads_url, 'Goodreads');
                }}
                disabled={!book.goodreads_url}
              >
                <ExternalLink size={16} color="#82713D" />
                <Text style={[styles.linkPillText, { color: '#82713D' }]}>
                  {book.goodreads_url ? 'Open Goodreads' : 'Goodreads link missing'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.reportLinkBtn}
                onPress={() => openReportModal('goodreads', book.goodreads_url || null)}
                disabled={reportSubmitting}
              >
                <Text style={styles.reportLinkBtnText}>
                  {book.goodreads_url ? 'Report' : 'Suggest'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.linkActionRow}>
              <TouchableOpacity
                style={[
                  styles.linkPill,
                  { backgroundColor: '#F5E8E8' },
                  !book.lubimyczytac_url && styles.linkPillDisabled,
                ]}
                onPress={() => {
                  if (book.lubimyczytac_url) handleOpenExternalUrl(book.lubimyczytac_url, 'LubimyCzytac');
                }}
                disabled={!book.lubimyczytac_url}
              >
                <ExternalLink size={16} color="#D32F2F" />
                <Text style={[styles.linkPillText, { color: '#D32F2F' }]}>
                  {book.lubimyczytac_url ? 'Open LubimyCzytać' : 'LubimyCzytać link missing'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.reportLinkBtn}
                onPress={() => openReportModal('lubimyczytac', book.lubimyczytac_url || null)}
                disabled={reportSubmitting}
              >
                <Text style={styles.reportLinkBtnText}>
                  {book.lubimyczytac_url ? 'Report' : 'Suggest'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>

    <InputModal
      visible={reportModalVisible}
      title={
        reportLinkType === 'goodreads'
          ? reportCurrentUrl
            ? 'Report Goodreads Link'
            : 'Suggest Goodreads Link'
          : reportCurrentUrl
            ? 'Report LubimyCzytać Link'
            : 'Suggest LubimyCzytać Link'
      }
      message={
        reportLinkType === 'goodreads'
          ? reportCurrentUrl
            ? 'Paste the correct Goodreads URL. Example: https://www.goodreads.com/book/show/...'
            : 'Goodreads link is missing. Suggest the correct URL. Example: https://www.goodreads.com/book/show/...'
          : reportCurrentUrl
            ? 'Paste the correct LubimyCzytać URL. Example: https://lubimyczytac.pl/ksiazka/...'
            : 'LubimyCzytać link is missing. Suggest the correct URL. Example: https://lubimyczytac.pl/ksiazka/...'
      }
      placeholder={reportLinkType === 'goodreads' ? 'https://www.goodreads.com/book/show/...' : 'https://lubimyczytac.pl/ksiazka/...'}
      onSave={handleSaveReportedUrl}
      onCancel={() => {
        if (reportSubmitting) return;
        setReportModalVisible(false);
        setReportLinkType(null);
        setReportCurrentUrl(null);
      }}
      keyboardType="default"
    />
    </>
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
    marginBottom: 24,
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  ratingHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ratingHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stars: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    marginBottom: 12,
  },
  avgRating: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '700',
  },
  reviewHint: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 8,
  },
  reviewInput: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    marginBottom: 12,
  },
  saveReviewBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  saveReviewText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
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
  linkRows: {
    marginTop: 8,
    gap: 10,
  },
  linkActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reportLinkBtn: {
    minWidth: 94,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportLinkBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  linkPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    minHeight: 50,
  },
  linkPillDisabled: {
    opacity: 0.6,
  },
  linkPillText: {
    fontSize: 14,
    fontWeight: '700',
  }
});
