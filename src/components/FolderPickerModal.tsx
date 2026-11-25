import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { showAlert } from '../utils/alert';
import { listDriveFolders, createDriveFolder } from '../utils/drive';
import { withGoogleAccessTokenRetry } from '../utils/googleAuth';

import { useTheme } from '../contexts/ThemeContext';

type Folder = { id: string; name: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelectFolder: (folderId: string | null, folderName?: string) => void;
};

export default function FolderPickerModal({ visible, onClose, onSelectFolder }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

  useEffect(() => {
    if (visible) fetchFolders();
  }, [visible]);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      if (!rootId) throw new Error('Shared folder ID is missing in .env');

      const data = await withGoogleAccessTokenRetry((token) => listDriveFolders(token, rootId));
      setFolders(data);
    } catch (e: any) {
      showAlert('Error', e.message || 'Could not fetch folders');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      setCreating(true);
      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      if (!rootId) throw new Error('Missing auth or root folder config');

      const newFolder = await withGoogleAccessTokenRetry((token) => createDriveFolder(trimmed, token, rootId));
      setNewFolderName('');
      
      onSelectFolder(newFolder.id, newFolder.name);
    } catch (e: any) {
      showAlert('Error', e.message || 'Could not create folder');
    } finally {
      setCreating(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Select Destination</Text>

          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              placeholder="New folder name..."
              placeholderTextColor={isDark ? '#555' : '#AAA'}
              value={newFolderName}
              onChangeText={setNewFolderName}
            />
            <TouchableOpacity style={styles.createBtn} onPress={handleCreateFolder} disabled={creating || !newFolderName.trim()}>
              {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.createBtnText}>Create</Text>}
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 30 }} />
          ) : (
            <FlatList
              data={folders}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <TouchableOpacity style={styles.folderRow} onPress={() => onSelectFolder(null)}>
                  <Text style={styles.folderIcon}>📁</Text>
                  <Text style={styles.folderName}>Uncategorized (Root)</Text>
                </TouchableOpacity>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.folderRow} onPress={() => onSelectFolder(item.id, item.name)}>
                  <Text style={styles.folderIcon}>📁</Text>
                  <Text style={styles.folderName}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '80%', paddingBottom: 40,
    borderWidth: isDark ? 1 : 0, borderColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.primary, marginBottom: 16 },
  createRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  input: {
    flex: 1, height: 44, backgroundColor: colors.inputBg, borderRadius: 12,
    paddingHorizontal: 14, fontSize: 15, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  createBtn: {
    backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { paddingBottom: 20 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  folderIcon: { fontSize: 24, marginRight: 12 },
  folderName: { fontSize: 16, color: colors.text, fontWeight: '500' },
  cancelBtn: {
    marginTop: 10, paddingVertical: 14, alignItems: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F5E8FA', borderRadius: 12,
  },
  cancelBtnText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
});
