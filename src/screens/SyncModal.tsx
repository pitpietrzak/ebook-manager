import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, FlatList,
  TextInput, ActivityIndicator, Alert, ScrollView, SafeAreaView
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../utils/supabase';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
};

type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
};

type Step = 'mode' | 'browse' | 'grouping' | 'syncing';

export default function SyncModal({ visible, onClose, onSyncComplete }: Props) {
  const [step, setStep] = useState<Step>('mode');
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<DriveItem[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [groupingMode, setGroupingMode] = useState<'auto' | 'custom'>('auto');
  const [customCollection, setCustomCollection] = useState('');
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, status: '' });

  const sharedFolderId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;

  // Always reset to initial state when the modal opens
  useEffect(() => {
    if (visible) reset();
  }, [visible]);

  const reset = () => {
    setStep('mode');
    setDriveItems([]);
    setFolderStack([]);
    setSelectedFiles([]);
    setGroupingMode('auto');
    setCustomCollection('');
    setSyncProgress({ current: 0, total: 0, status: '' });
  };

  const handleClose = () => { reset(); onClose(); };

  // --- Fetch folder contents from Google Drive ---
  const fetchDriveFolder = async (folderId: string) => {
    setLoadingDrive(true);
    try {
      const token = await SecureStore.getItemAsync('google_provider_token');
      if (!token) throw new Error('Missing Google token — please re-login');

      const query = `'${folderId}' in parents and trashed = false`;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&orderBy=name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const items: DriveItem[] = (data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      })).filter((f: DriveItem) =>
        f.isFolder ||
        f.mimeType === 'application/epub+zip' ||
        f.mimeType === 'application/pdf'
      );

      setDriveItems(items);
    } catch (e: any) {
      Alert.alert('Drive Error', e.message);
    } finally {
      setLoadingDrive(false);
    }
  };

  const openSelectMode = async () => {
    if (!sharedFolderId) {
      Alert.alert('Config Error', 'EXPO_PUBLIC_SHARED_FOLDER_ID is not set in your .env file');
      return;
    }
    setStep('browse');
    setFolderStack([{ id: sharedFolderId, name: 'Library' }]);
    await fetchDriveFolder(sharedFolderId);
  };

  const navigateIntoFolder = async (folder: DriveItem) => {
    setFolderStack(prev => [...prev, { id: folder.id, name: folder.name }]);
    await fetchDriveFolder(folder.id);
  };

  const navigateUp = async () => {
    if (folderStack.length <= 1) return;
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    await fetchDriveFolder(newStack[newStack.length - 1].id);
  };

  const toggleFileSelection = (item: DriveItem) => {
    setSelectedFiles(prev => {
      const exists = prev.find(f => f.id === item.id);
      return exists ? prev.filter(f => f.id !== item.id) : [...prev, item];
    });
  };

  const selectAllInFolder = () => {
    const files = driveItems.filter(f => !f.isFolder);
    const allSelected = files.every(f => selectedFiles.find(s => s.id === f.id));
    if (allSelected) {
      setSelectedFiles(prev => prev.filter(f => !files.find(ff => ff.id === f.id)));
    } else {
      setSelectedFiles(prev => {
        const existing = new Set(prev.map(f => f.id));
        const toAdd = files.filter(f => !existing.has(f.id));
        return [...prev, ...toAdd];
      });
    }
  };

  // --- Full Drive Sync ---
  const runFullSync = async () => {
    setStep('syncing');
    setSyncProgress({ current: 0, total: 0, status: 'Scanning Google Drive...' });
    try {
      const token = await SecureStore.getItemAsync('google_provider_token');
      if (!token) throw new Error('Missing Google token');

      const { data, error } = await supabase.functions.invoke('sync-drive', {
        body: { providerToken: token, sharedFolderId }
      });
      if (error) throw new Error(error.message);

      const newBooks = data?.newBooks || [];
      if (newBooks.length === 0) {
        setSyncProgress({ current: 0, total: 0, status: 'All books are already synced! ✅' });
        setTimeout(onSyncComplete, 1500);
        return;
      }

      setSyncProgress({ current: 0, total: newBooks.length, status: `Processing ${newBooks.length} new books...` });

      let done = 0;
      for (const book of newBooks) {
        setSyncProgress(p => ({ ...p, current: done, status: `Processing: ${book.fileName}` }));
        await supabase.functions.invoke('process-ebook', {
          body: { driveFileId: book.driveFileId, fileName: book.fileName, folderTags: book.folderTags }
        });
        done++;
      }

      setSyncProgress({ current: done, total: done, status: `Done! Synced ${done} new books ✅` });
      setTimeout(onSyncComplete, 1500);
    } catch (e: any) {
      setSyncProgress({ current: 0, total: 0, status: `Error: ${e.message}` });
    }
  };

  // --- Selected Books Sync ---
  const proceedToGrouping = () => {
    if (selectedFiles.length === 0) {
      Alert.alert('No books selected', 'Please select at least one book.');
      return;
    }
    setStep('grouping');
  };

  const runSelectedSync = async () => {
    setStep('syncing');
    const tags = groupingMode === 'auto'
      ? folderStack.slice(1).map(f => f.name)
      : customCollection ? [customCollection] : [];

    setSyncProgress({ current: 0, total: selectedFiles.length, status: 'Processing selected books...' });

    let done = 0;
    for (const file of selectedFiles) {
      setSyncProgress(p => ({ ...p, current: done, status: `Processing: ${file.name}` }));
      await supabase.functions.invoke('process-ebook', {
        body: { driveFileId: file.id, fileName: file.name, folderTags: tags }
      });
      done++;
    }
    setSyncProgress({ current: done, total: done, status: `Done! Added ${done} books ✅` });
    setTimeout(onSyncComplete, 1500);
  };

  // ---- Render steps ----
  const renderModeStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Sync Books</Text>
      <Text style={styles.stepSubtitle}>How would you like to import?</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity style={styles.modeCard} onPress={runFullSync}>
          <Text style={styles.modeIcon}>🔄</Text>
          <Text style={styles.modeTitle}>Full Sync</Text>
          <Text style={styles.modeDesc}>Scan entire Drive and import all new books automatically</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.modeCard} onPress={openSelectMode}>
          <Text style={styles.modeIcon}>☑️</Text>
          <Text style={styles.modeTitle}>Select Books</Text>
          <Text style={styles.modeDesc}>Browse your Drive and pick exactly what to import</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const currentFolderName = folderStack[folderStack.length - 1]?.name || 'Library';
  const filesInFolder = driveItems.filter(f => !f.isFolder);
  const allFilesSelected = filesInFolder.length > 0 && filesInFolder.every(f => selectedFiles.find(s => s.id === f.id));

  const renderBrowseStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.browseHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepTitle}>📁 {currentFolderName}</Text>
          <Text style={styles.stepSubtitle}>{selectedFiles.length} books selected</Text>
        </View>
        {folderStack.length > 1 && (
          <TouchableOpacity onPress={navigateUp} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
      </View>

      {filesInFolder.length > 0 && (
        <TouchableOpacity style={styles.selectAllBtn} onPress={selectAllInFolder}>
          <Text style={styles.selectAllText}>
            {allFilesSelected ? 'Deselect all in folder' : 'Select all in folder'}
          </Text>
        </TouchableOpacity>
      )}

      {loadingDrive ? (
        <ActivityIndicator color="#6C63FF" style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={driveItems}
          keyExtractor={item => item.id}
          style={{ maxHeight: 320 }}
          renderItem={({ item }) => {
            const isSelected = !!selectedFiles.find(f => f.id === item.id);
            return (
              <TouchableOpacity
                style={[styles.driveItem, isSelected && styles.driveItemSelected]}
                onPress={() => item.isFolder ? navigateIntoFolder(item) : toggleFileSelection(item)}
              >
                <Text style={styles.driveItemIcon}>{item.isFolder ? '📁' : item.mimeType.includes('pdf') ? '📄' : '📖'}</Text>
                <Text style={styles.driveItemName} numberOfLines={1}>{item.name}</Text>
                {!item.isFolder && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                )}
                {item.isFolder && <Text style={styles.folderArrow}>›</Text>}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyDrive}>This folder is empty</Text>}
        />
      )}

      <View style={styles.browseFooter}>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, selectedFiles.length === 0 && styles.primaryBtnDisabled]}
          onPress={proceedToGrouping}
          disabled={selectedFiles.length === 0}
        >
          <Text style={styles.primaryBtnText}>Next ({selectedFiles.length})</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderGroupingStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Organise Books</Text>
      <Text style={styles.stepSubtitle}>How should these {selectedFiles.length} books be grouped?</Text>

      <TouchableOpacity
        style={[styles.groupOption, groupingMode === 'auto' && styles.groupOptionActive]}
        onPress={() => setGroupingMode('auto')}
      >
        <View style={styles.groupOptionHeader}>
          <Text style={styles.groupOptionIcon}>📁</Text>
          <Text style={styles.groupOptionTitle}>Use Drive Folder Names</Text>
          {groupingMode === 'auto' && <Text style={styles.groupOptionCheck}>✓</Text>}
        </View>
        <Text style={styles.groupOptionDesc}>
          Books will inherit the folder structure from Google Drive
          {folderStack.length > 1 ? ` (${folderStack.slice(1).map(f => f.name).join(' › ')})` : ''}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.groupOption, groupingMode === 'custom' && styles.groupOptionActive]}
        onPress={() => setGroupingMode('custom')}
      >
        <View style={styles.groupOptionHeader}>
          <Text style={styles.groupOptionIcon}>🏷️</Text>
          <Text style={styles.groupOptionTitle}>Custom Collection</Text>
          {groupingMode === 'custom' && <Text style={styles.groupOptionCheck}>✓</Text>}
        </View>
        <Text style={styles.groupOptionDesc}>Assign these books to a collection you name</Text>
      </TouchableOpacity>

      {groupingMode === 'custom' && (
        <TextInput
          style={styles.customInput}
          placeholder="Collection name (e.g. Summer Reads)"
          value={customCollection}
          onChangeText={setCustomCollection}
          autoFocus
        />
      )}

      <View style={styles.browseFooter}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => setStep('browse')}>
          <Text style={styles.cancelBtnText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={runSelectedSync}>
          <Text style={styles.primaryBtnText}>Start Import</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSyncingStep = () => (
    <View style={[styles.stepContainer, { alignItems: 'center' }]}>
      <ActivityIndicator size="large" color="#6C63FF" style={{ marginBottom: 20 }} />
      <Text style={styles.stepTitle}>Syncing...</Text>
      {syncProgress.total > 0 && (
        <Text style={styles.progressText}>{syncProgress.current} / {syncProgress.total}</Text>
      )}
      <Text style={styles.statusText}>{syncProgress.status}</Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {step === 'mode' && renderModeStep()}
          {step === 'browse' && renderBrowseStep()}
          {step === 'grouping' && renderGroupingStep()}
          {step === 'syncing' && renderSyncingStep()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40,
    minHeight: 380,
  },
  stepContainer: { width: '100%' },
  stepTitle: { fontSize: 21, fontWeight: '700', color: '#1A1A2E', marginBottom: 6 },
  stepSubtitle: { fontSize: 14, color: '#888', marginBottom: 20 },
  modeRow: { flexDirection: 'row', gap: 12 },
  modeCard: {
    flex: 1, backgroundColor: '#F7F8FC', borderRadius: 16, padding: 18,
    borderWidth: 2, borderColor: '#E8E8F0', alignItems: 'center',
  },
  modeIcon: { fontSize: 32, marginBottom: 10 },
  modeTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A2E', marginBottom: 6, textAlign: 'center' },
  modeDesc: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },
  cancelBtn: {
    marginTop: 16, paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#888', fontSize: 15, fontWeight: '500' },
  browseHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backBtn: {
    backgroundColor: '#F0F0F7', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: { color: '#6C63FF', fontWeight: '600' },
  selectAllBtn: { marginBottom: 8 },
  selectAllText: { color: '#6C63FF', fontWeight: '600', fontSize: 13 },
  driveItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    paddingHorizontal: 8, borderRadius: 10, marginBottom: 4,
  },
  driveItemSelected: { backgroundColor: '#F0EFFE' },
  driveItemIcon: { fontSize: 20, marginRight: 12 },
  driveItemName: { flex: 1, fontSize: 15, color: '#1A1A2E' },
  folderArrow: { fontSize: 22, color: '#888' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#CCC',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: '#6C63FF', borderColor: '#6C63FF' },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptyDrive: { textAlign: 'center', color: '#888', marginTop: 30 },
  browseFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  primaryBtn: {
    backgroundColor: '#6C63FF', paddingHorizontal: 24, paddingVertical: 13,
    borderRadius: 14, flex: 1, marginLeft: 12, alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  groupOption: {
    backgroundColor: '#F7F8FC', borderRadius: 14, padding: 16,
    borderWidth: 2, borderColor: '#E8E8F0', marginBottom: 12,
  },
  groupOptionActive: { borderColor: '#6C63FF', backgroundColor: '#F0EFFE' },
  groupOptionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  groupOptionIcon: { fontSize: 18, marginRight: 8 },
  groupOptionTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1A1A2E' },
  groupOptionCheck: { color: '#6C63FF', fontWeight: '700', fontSize: 16 },
  groupOptionDesc: { fontSize: 13, color: '#888', paddingLeft: 26, lineHeight: 18 },
  customInput: {
    borderWidth: 2, borderColor: '#6C63FF', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 15,
    marginBottom: 8, color: '#1A1A2E',
  },
  progressText: { fontSize: 32, fontWeight: '700', color: '#6C63FF', marginBottom: 8 },
  statusText: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 12 },
});
