import React, { useState } from 'react';
import { 
  View, Text, Modal, StyleSheet, TouchableOpacity, 
  FlatList, TextInput, KeyboardAvoidingView, Platform,
  Pressable
} from 'react-native';
import { X, Search } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { ALL_ICONS } from '../constants/icons';
import DynamicIcon from './DynamicIcon';

interface IconPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  collectionName: string;
  currentColor: string;
}

export default function IconPickerModal({ 
  visible, onClose, onSelect, collectionName, currentColor 
}: IconPickerModalProps) {
  const { colors, isDark } = useTheme();
  const [search, setSearch] = useState('');
  const styles = getStyles(colors, isDark);

  const filteredIcons = ALL_ICONS.filter(icon => 
    icon.toLowerCase().includes(search.toLowerCase())
  );

  React.useEffect(() => {
    if (!visible) {
      setSearch('');
    }
  }, [visible]);

  const renderIconItem = ({ item }: { item: string }) => (
    <TouchableOpacity 
      style={styles.iconItem} 
      onPress={() => onSelect(item)}
    >
      <View style={[styles.iconWrapper, { backgroundColor: currentColor + '15' }]}>
        <DynamicIcon name={item} size={24} color={currentColor} />
      </View>
      <Text style={styles.iconName} numberOfLines={1}>{item}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={styles.container}>
            <View style={styles.content}>
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Pick an Icon</Text>
                  <Text style={styles.subtitle}>For "{collectionName}"</Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                  <X size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.searchBar}>
                <Search size={18} color={colors.textSecondary} style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search icons..."
                  placeholderTextColor={colors.textSecondary}
                  value={search}
                  onChangeText={setSearch}
                  autoFocus={false}
                />
              </View>

              <FlatList
                data={filteredIcons}
                renderItem={renderIconItem}
                keyExtractor={item => item}
                numColumns={4}
                columnWrapperStyle={styles.iconRow}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: '80%',
    width: '100%',
  },
  content: {
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  listContent: {
    paddingBottom: 40,
  },
  iconRow: {
    justifyContent: 'flex-start',
  },
  iconItem: {
    width: '25%',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  iconName: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
