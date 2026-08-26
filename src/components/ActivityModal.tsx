import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList,
  ActivityIndicator, SafeAreaView, Dimensions
} from 'react-native';
import { Star, Bell } from 'lucide-react-native';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';

const { height } = Dimensions.get('window');

type ActivityItem = {
  id: string;
  kind: 'notification' | 'rating';
  bookId: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectBook: (bookId: string) => void;
}

// Merges the notifications table (new book uploads, etc.) with recent ratings
// into a single chronological feed — the app previously had these split
// across an unreachable notification bell and a small Dashboard widget.
export default function ActivityModal({ visible, onClose, onSelectBook }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  useEffect(() => {
    if (visible) {
      fetchActivity();
    }
  }, [visible]);

  const fetchActivity = async () => {
    setLoading(true);
    try {
      const [notificationsResult, ratingsResult] = await Promise.all([
        supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('book_ratings')
          .select('id, book_id, user_id, review, rating, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const notifications = notificationsResult.data || [];
      const ratings = ratingsResult.data || [];

      let bookMap: Record<string, { title: string }> = {};
      let reviewerMap: Record<string, string> = {};
      if (ratings.length > 0) {
        const bookIds = Array.from(new Set(ratings.map((r) => r.book_id)));
        const reviewerIds = Array.from(new Set(ratings.map((r) => r.user_id)));
        const [{ data: books }, { data: reviewers }] = await Promise.all([
          supabase.from('books').select('id, title').in('id', bookIds),
          supabase.rpc('get_public_profiles', { profile_ids: reviewerIds }),
        ]);
        bookMap = Object.fromEntries((books || []).map((b: any) => [b.id, b]));
        reviewerMap = Object.fromEntries((reviewers || []).map((r: any) => [
          r.id,
          r.display_name?.trim() || r.email?.split('@')[0] || 'Reader',
        ]));
      }

      const notificationItems: ActivityItem[] = notifications.map((n: any) => ({
        id: `notification:${n.id}`,
        kind: 'notification',
        bookId: n.book_id,
        title: n.title,
        body: n.body,
        createdAt: n.created_at,
        isRead: n.is_read,
      }));

      const ratingItems: ActivityItem[] = ratings.map((r: any) => ({
        id: `rating:${r.id}`,
        kind: 'rating',
        bookId: r.book_id,
        title: `${reviewerMap[r.user_id] || 'Reader'} rated "${bookMap[r.book_id]?.title || 'a book'}" ${r.rating}★`,
        body: r.review || '',
        createdAt: r.created_at,
        isRead: true,
      }));

      const merged = [...notificationItems, ...ratingItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setItems(merged.slice(0, 30));
    } catch (e) {
      console.error('Fetch activity error:', e);
    } finally {
      setLoading(false);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false);
      if (!error) {
        setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
      }
    } catch (e) {
      console.error('Mark as read error:', e);
    }
  };

  const handleSelect = async (item: ActivityItem) => {
    if (item.kind === 'notification' && !item.isRead) {
      const notificationId = item.id.replace('notification:', '');
      await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)));
    }
    onSelectBook(item.bookId);
    onClose();
  };

  const hasUnread = items.some((item) => item.kind === 'notification' && !item.isRead);

  const renderItem = ({ item }: { item: ActivityItem }) => (
    <TouchableOpacity
      style={[styles.item, !item.isRead && styles.itemUnread]}
      onPress={() => handleSelect(item)}
    >
      <View style={styles.itemIcon}>
        {item.kind === 'rating'
          ? <Star size={16} color={colors.accent} />
          : <Bell size={16} color={colors.primary} />}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {!item.isRead && <View style={styles.dot} />}
        </View>
        {item.body ? <Text style={styles.itemBody}>{item.body}</Text> : null}
        <Text style={styles.itemTime}>
          {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.header}>
              <Text style={styles.title}>Family Activity</Text>
              {hasUnread && (
                <TouchableOpacity onPress={markAllAsRead}>
                  <Text style={styles.markReadBtn}>Mark all as read</Text>
                </TouchableOpacity>
              )}
            </View>

            {loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyIcon}>🦥</Text>
                    <Text style={styles.emptyText}>No activity yet!</Text>
                  </View>
                }
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    height: height * 0.7, paddingHorizontal: 20, paddingTop: 16,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  markReadBtn: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  item: {
    flexDirection: 'row', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#2D1B45' : '#F0F0F0',
  },
  itemIcon: {
    width: 28, height: 28, borderRadius: 14, marginTop: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  },
  itemUnread: { backgroundColor: isDark ? 'rgba(187,134,252,0.05)' : 'rgba(187,134,252,0.1)', marginHorizontal: -20, paddingHorizontal: 20 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginLeft: 8 },
  itemBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  itemTime: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: colors.textSecondary, fontWeight: '500' },
});
