import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, FlatList,
  TextInput, ActivityIndicator, Alert, ScrollView, SafeAreaView
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../utils/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { 
  RefreshCw, Folder, FileText, BookOpen, Check, 
  ChevronRight, ChevronLeft, X, Layers, Settings,
  Database, HardDrive, CheckCircle2
} from 'lucide-react-native';

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
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);

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
      <View style={styles.header}>
        <Text style={styles.stepTitle}>Sync Books</Text>
        <TouchableOpacity onPress={handleClose}>
          <X size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.stepSubtitle}>Import your library from Google Drive</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity style={styles.modeCard} onPress={runFullSync}>
          <View style={[styles.modeIconContainer, { backgroundColor: colors.primary + '11' }]}>
            <RefreshCw size={32} color={colors.primary} />
          </View>
          <Text style={styles.modeTitle}>Full Sync</Text>
          <Text style={styles.modeDesc}>Scan everything and import new books automatically</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.modeCard} onPress={openSelectMode}>
          <View style={[styles.modeIconContainer, { backgroundColor: colors.accent + '11' }]}>
            <Layers size={32} color={colors.accent} />
          </View>
          <Text style={styles.modeTitle}>Select Books</Text>
          <Text style={styles.modeDesc}>Browse your Drive and pick specific files to add</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const currentFolderName = folderStack[folderStack.length - 1]?.name || 'Library';
  const filesInFolder = driveItems.filter(f => !f.isFolder);
  const allFilesSelected = filesInFolder.length > 0 && filesInFolder.every(f => selectedFiles.find(s => s.id === f.id));

  const renderBrowseStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.browseHeader}>
        {folderStack.length > 1 && (
          <TouchableOpacity onPress={navigateUp} style={styles.backBtn}>
            <ChevronLeft size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1, marginLeft: folderStack.length > 1 ? 12 : 0 }}>
          <Text style={styles.stepTitle}>{currentFolderName}</Text>
          <Text style={styles.stepSubtitle}>{selectedFiles.length} selected</Text>
        </View>
        <TouchableOpacity onPress={handleClose}>
          <X size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {filesInFolder.length > 0 && (
        <TouchableOpacity style={styles.selectAllBtn} onPress={selectAllInFolder}>
          <Text style={styles.selectAllText}>
            {allFilesSelected ? 'Deselect all in folder' : 'Select all in folder'}
          </Text>
        </TouchableOpacity>
      )}

      {loadingDrive ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
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
                <View style={styles.driveItemIconBox}>
                  {item.isFolder ? (
                    <Folder size={20} color={colors.primary} />
                  ) : item.mimeType.includes('pdf') ? (
                    <FileText size={20} color="#FF5252" />
                  ) : (
                    <BookOpen size={20} color={colors.accent} />
                  )}
                </View>
                <Text style={styles.driveItemName} numberOfLines={1}>{item.name}</Text>
                {!item.isFolder && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
                  </View>
                )}
                {item.isFolder && <ChevronRight size={20} color={colors.border} />}
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
          <Folder size={20} color={groupingMode === 'auto' ? colors.primary : colors.textSecondary} style={{ marginRight: 12 }} />
          <Text style={styles.groupOptionTitle}>Use Drive Folders</Text>
          {groupingMode === 'auto' && <CheckCircle2 size={20} color={colors.primary} />}
        </View>
        <Text style={styles.groupOptionDesc}>
          {folderStack.length > 1 
            ? `Organises under "${folderStack.slice(1).map(f => f.name).join(' › ')}"` 
            : 'Uses existing folder structure from Drive'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.groupOption, groupingMode === 'custom' && styles.groupOptionActive]}
        onPress={() => setGroupingMode('custom')}
      >
        <View style={styles.groupOptionHeader}>
          <Layers size={20} color={groupingMode === 'custom' ? colors.primary : colors.textSecondary} style={{ marginRight: 12 }} />
          <Text style={styles.groupOptionTitle}>Custom Collection</Text>
          {groupingMode === 'custom' && <CheckCircle2 size={20} color={colors.primary} />}
        </View>
        <Text style={styles.groupOptionDesc}>Create a new collection for these books</Text>
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
      <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 20 }} />
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

const getStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40,
    minHeight: 400,
    borderWidth: 1, borderColor: colors.border,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  stepContainer: { width: '100%' },
  stepTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  stepSubtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 24 },
  modeRow: { flexDirection: 'row', gap: 16 },
  modeCard: {
    flex: 1, backgroundColor: colors.background, borderRadius: 24, padding: 20,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  modeIconContainer: {
    width: 64, height: 64, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  modeTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
  modeDesc: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  cancelBtn: {
    paddingVertical: 14, paddingHorizontal: 20,
    alignItems: 'center', borderRadius: 12,
  },
  cancelBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
  browseHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  selectAllBtn: { marginBottom: 12, paddingHorizontal: 4 },
  selectAllText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  driveItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    paddingHorizontal: 12, borderRadius: 16, marginBottom: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  driveItemSelected: { 
    backgroundColor: colors.primary + '08', 
    borderColor: colors.primary + '22' 
  },
  driveItemIconBox: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  driveItemName: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  checkbox: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyDrive: { textAlign: 'center', color: colors.textSecondary, marginTop: 40, fontSize: 15 },
  browseFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  primaryBtn: {
    backgroundColor: colors.primary, paddingVertical: 15,
    borderRadius: 18, flex: 1, marginLeft: 16, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.3, shadowOpacity: 0 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  groupOption: {
    backgroundColor: colors.background, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  groupOptionActive: { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
  groupOptionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  groupOptionTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  groupOptionDesc: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  customInput: {
    backgroundColor: colors.background,
    borderWidth: 2, borderColor: colors.primary, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    marginBottom: 20, color: colors.text,
  },
  progressText: { fontSize: 48, fontWeight: '800', color: colors.primary, marginBottom: 12 },
  statusText: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginTop: 12, fontWeight: '500' },
});
