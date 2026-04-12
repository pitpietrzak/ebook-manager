import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, TextInput, ActivityIndicator, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { listDriveFolders, createDriveFolder } from '../utils/drive';

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

  useEffect(() => {
    if (visible) fetchFolders();
  }, [visible]);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const token = await SecureStore.getItemAsync('google_provider_token');
      if (!token) throw new Error('No Google token available');
      
      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      if (!rootId) throw new Error('Shared folder ID is missing in .env');

      const data = await listDriveFolders(token, rootId);
      setFolders(data);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not fetch folders');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      setCreating(true);
      const token = await SecureStore.getItemAsync('google_provider_token');
      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      if (!token || !rootId) throw new Error('Missing auth or root folder config');

      const newFolder = await createDriveFolder(trimmed, token, rootId);
      setNewFolderName('');
      
      // Auto select the newly created folder rather than just refreshing the list
      onSelectFolder(newFolder.id, newFolder.name);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not create folder');
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
              placeholderTextColor="#AAA"
              value={newFolderName}
              onChangeText={setNewFolderName}
            />
            <TouchableOpacity style={styles.createBtn} onPress={handleCreateFolder} disabled={creating || !newFolderName.trim()}>
              {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.createBtnText}>Create</Text>}
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#531492" style={{ marginVertical: 30 }} />
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

const PURPLE = '#531492';
const PINK = '#E80F88';

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '80%', paddingBottom: 40,
  },
  title: { fontSize: 20, fontWeight: '700', color: PURPLE, marginBottom: 16 },
  createRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  input: {
    flex: 1, height: 44, backgroundColor: '#FDF8FF', borderRadius: 12,
    paddingHorizontal: 14, fontSize: 15, color: '#1A1A2E',
    borderWidth: 1, borderColor: '#F5E8FA',
  },
  createBtn: {
    backgroundColor: PINK, borderRadius: 12, paddingHorizontal: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { paddingBottom: 20 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#FDF8FF',
  },
  folderIcon: { fontSize: 24, marginRight: 12 },
  folderName: { fontSize: 16, color: '#333', fontWeight: '500' },
  cancelBtn: {
    marginTop: 10, paddingVertical: 14, alignItems: 'center',
    backgroundColor: '#F5E8FA', borderRadius: 12,
  },
  cancelBtnText: { color: PURPLE, fontSize: 16, fontWeight: '700' },
});
