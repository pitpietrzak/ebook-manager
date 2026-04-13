import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList,
  ActivityIndicator, SafeAreaView, Dimensions
} from 'react-native';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';

const { height } = Dimensions.get('window');

type Notification = {
  id: string;
  type: 'new_book' | 'new_rating';
  title: string;
  body: string;
  book_id: string;
  is_read: boolean;
  created_at: string;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectBook: (bookId: string) => void;
}

export default function NotificationModal({ visible, onClose, onSelectBook }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  useEffect(() => {
    if (visible) {
      fetchNotifications();
    }
  }, [visible]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.warn('Notifications fetch failed:', error.message);
      } else if (data) {
        setNotifications(data);
      }
    } catch (e) {
      console.error('Fetch notifications error:', e);
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
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      }
    } catch (e) {
      console.error('Mark as read error:', e);
    }
  };

  const handleSelect = async (item: Notification) => {
    // Mark this one as read
    if (!item.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', item.id);
    }
    onSelectBook(item.book_id);
    onClose();
  };

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity 
      style={[styles.item, !item.is_read && styles.itemUnread]} 
      onPress={() => handleSelect(item)}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.title}</Text>
        {!item.is_read && <View style={styles.dot} />}
      </View>
      <Text style={styles.itemBody}>{item.body}</Text>
      <Text style={styles.itemTime}>{new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.header}>
              <Text style={styles.title}>Notifications</Text>
              <TouchableOpacity onPress={markAllAsRead}>
                <Text style={styles.markReadBtn}>Mark all as read</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text style={styles.emptyIcon}>🦥</Text>
                    <Text style={styles.emptyText}>No new notifications yet!</Text>
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
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#2D1B45' : '#F0F0F0',
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
