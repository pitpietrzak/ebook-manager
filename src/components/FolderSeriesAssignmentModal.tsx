import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

type BookEntry = {
  id: string;
  title: string;
  author: string;
  initialSeriesPart?: number | null;
};

type SavePayload = {
  seriesName: string;
  assignments: Array<{ bookId: string; seriesPart: number | null }>;
};

type Props = {
  visible: boolean;
  folderName: string;
  books: BookEntry[];
  loadingBooks?: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSave: (payload: SavePayload) => void;
};

type PartMap = Record<string, string>;

function parsePart(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? rounded : null;
}

export default function FolderSeriesAssignmentModal({
  visible,
  folderName,
  books,
  loadingBooks = false,
  saving = false,
  onCancel,
  onSave,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  const [seriesName, setSeriesName] = useState('');
  const [parts, setParts] = useState<PartMap>({});

  useEffect(() => {
    if (!visible) return;
    setSeriesName('');
    const initial: PartMap = {};
    books.forEach((book) => {
      initial[book.id] = book.initialSeriesPart ? String(book.initialSeriesPart) : '';
    });
    setParts(initial);
  }, [visible, books]);

  const rows = useMemo(() => books, [books]);

  const handleSave = () => {
    const cleanName = seriesName.trim();
    if (!cleanName) return;

    onSave({
      seriesName: cleanName,
      assignments: rows.map((book) => ({
        bookId: book.id,
        seriesPart: parsePart(parts[book.id] || ''),
      })),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={styles.card}>
              <Text style={styles.title}>Set Series For Folder</Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                Folder: {folderName}
              </Text>

              <TextInput
                style={styles.seriesInput}
                value={seriesName}
                onChangeText={setSeriesName}
                placeholder="Series name (required)"
                placeholderTextColor={colors.textSecondary + '88'}
                selectionColor={colors.primary}
              />

              {loadingBooks ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.loadingText}>Loading books...</Text>
                </View>
              ) : (
                <FlatList
                  data={rows}
                  keyExtractor={(item) => item.id}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <View style={styles.bookRow}>
                      <View style={styles.bookMeta}>
                        <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.bookAuthor} numberOfLines={1}>{item.author}</Text>
                      </View>
                      <TextInput
                        style={styles.partInput}
                        value={parts[item.id] || ''}
                        onChangeText={(value) => setParts((prev) => ({ ...prev, [item.id]: value }))}
                        placeholder="#"
                        placeholderTextColor={colors.textSecondary + '88'}
                        keyboardType="decimal-pad"
                        selectionColor={colors.primary}
                      />
                    </View>
                  )}
                />
              )}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, (!seriesName.trim() || saving) && { opacity: 0.65 }]}
                  onPress={handleSave}
                  disabled={!seriesName.trim() || saving}
                >
                  <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Series'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  seriesInput: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
    maxHeight: 320,
  },
  listContent: {
    paddingBottom: 4,
  },
  loadingWrap: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '55',
  },
  bookMeta: {
    flex: 1,
  },
  bookTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  bookAuthor: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  partInput: {
    width: 64,
    textAlign: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1.3,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  saveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});
