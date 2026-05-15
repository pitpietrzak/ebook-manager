import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../utils/supabase';

const { width } = Dimensions.get('window');

type SeriesOption = {
  id: string;
  name: string;
};

type Props = {
  visible: boolean;
  title?: string;
  initialSeriesName?: string;
  initialSeriesPart?: number | null;
  onCancel: () => void;
  onSave: (payload: { seriesName: string; seriesPart: number | null }) => void;
  saveLabel?: string;
  skipLabel?: string;
};

export default function SeriesAssignmentModal({
  visible,
  title = 'Add To Series (Optional)',
  initialSeriesName = '',
  initialSeriesPart = null,
  onCancel,
  onSave,
  saveLabel = 'Save',
  skipLabel = 'Skip',
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  const [seriesName, setSeriesName] = useState(initialSeriesName);
  const [seriesPartRaw, setSeriesPartRaw] = useState(initialSeriesPart ? String(initialSeriesPart) : '');
  const [suggestions, setSuggestions] = useState<SeriesOption[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [seriesNameFocused, setSeriesNameFocused] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSeriesName(initialSeriesName || '');
    setSeriesPartRaw(initialSeriesPart ? String(initialSeriesPart) : '');
    setSeriesNameFocused(false);
  }, [visible, initialSeriesName, initialSeriesPart]);

  useEffect(() => {
    if (!visible || !seriesNameFocused || !seriesName.trim()) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    let cancelled = false;
    const loadSuggestions = async () => {
      try {
        setLoadingSuggestions(true);
        const search = seriesName.trim();

        let query = supabase
          .from('series')
          .select('id, name')
          .order('name', { ascending: true })
          .limit(8);

        if (search) {
          query = query.ilike('name', `%${search}%`);
        }

        const { data } = await query;
        if (cancelled) return;

        setSuggestions((data || []) as SeriesOption[]);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    };

    const timer = setTimeout(loadSuggestions, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, seriesName, seriesNameFocused]);

  const showSuggestions = seriesNameFocused && !!seriesName.trim();

  const parsedPart = (() => {
    const normalized = seriesPartRaw.trim().replace(',', '.');
    const value = Number(normalized);
    if (!seriesPartRaw.trim()) return null;
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value * 100) / 100;
    return rounded > 0 ? rounded : null;
  })();

  const handleSave = () => {
    onSave({
      seriesName: seriesName.trim(),
      seriesPart: parsedPart,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
            <View style={styles.card}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>
                Leave the series name empty to continue without series.
              </Text>

              <View style={styles.seriesInputWrap}>
                <TextInput
                  style={styles.input}
                  value={seriesName}
                  onChangeText={setSeriesName}
                  placeholder="Series name (e.g. The Witcher)"
                  placeholderTextColor={colors.textSecondary + '88'}
                  selectionColor={colors.primary}
                  autoFocus
                  onFocus={() => setSeriesNameFocused(true)}
                  onBlur={() => {
                    setTimeout(() => setSeriesNameFocused(false), 120);
                  }}
                />

                {showSuggestions ? (
                  <View style={styles.suggestionsDropdown}>
                    {loadingSuggestions ? (
                      <Text style={styles.suggestionHint}>Loading existing series...</Text>
                    ) : suggestions.length > 0 ? (
                      suggestions.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.suggestionItem}
                          onPress={() => {
                            setSeriesName(item.name);
                            setSeriesNameFocused(false);
                            Keyboard.dismiss();
                          }}
                        >
                          <Text style={styles.suggestionText}>{item.name}</Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.suggestionHint}>No existing match. A new series will be created.</Text>
                    )}
                  </View>
                ) : null}
              </View>

              <TextInput
                style={styles.input}
                value={seriesPartRaw}
                onChangeText={setSeriesPartRaw}
                placeholder="Part number (e.g. 1 or 0.7)"
                placeholderTextColor={colors.textSecondary + '88'}
                keyboardType="decimal-pad"
                selectionColor={colors.primary}
              />

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.skipBtn}
                  onPress={() => onSave({ seriesName: '', seriesPart: null })}
                >
                  <Text style={styles.skipText}>{skipLabel}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveText}>{saveLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
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
  },
  keyboardView: {
    width: '100%',
    alignItems: 'center',
  },
  card: {
    width: width * 0.9,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
    textAlign: 'center',
  },
  input: {
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
  seriesInputWrap: {
    position: 'relative',
    zIndex: 20,
  },
  suggestionsDropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 50,
    maxHeight: 130,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
    marginBottom: 6,
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 50,
  },
  suggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  suggestionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionHint: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  },
  cancelText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 14,
  },
  skipBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.accent + '22',
  },
  skipText: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  saveBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  saveText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});
