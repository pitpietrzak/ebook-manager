import React, { useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { uploadFileToDrive, getOrCreateFolder } from '../utils/drive';
import { supabase } from '../utils/supabase';
import FolderPickerModal from '../components/FolderPickerModal';

export function useBookUpload(onSuccess: () => void) {
  const [isUploading, setIsUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null);

  const startUpload = async (defaultCollectionName?: string | null) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];

      if (defaultCollectionName && defaultCollectionName !== '__uncategorised__') {
        // Direct upload to specific context
        await executeUpload(file, null, defaultCollectionName);
      } else {
        // Needs folder selection
        setPendingFile(file);
        setPickerVisible(true);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not pick file');
    }
  };

  const handleFolderSelected = async (targetFolderId: string | null, targetFolderName?: string) => {
    setPickerVisible(false);
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    await executeUpload(file, targetFolderId, targetFolderName);
  };

  const executeUpload = async (file: any, targetFolderId: string | null, targetFolderName?: string) => {
    try {
      setIsUploading(true);
      const providerToken = await SecureStore.getItemAsync('google_provider_token');
      if (!providerToken) throw new Error('Missing Google token. Please logout and login again.');

      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      let finalFolderId = targetFolderId;

      // If we only have a targetFolderName (because of direct contextual upload), resolve the ID
      if (!finalFolderId && targetFolderName && rootId) {
        const folder = await getOrCreateFolder(targetFolderName, providerToken, rootId);
        finalFolderId = folder.id;
      }

      // 1. Upload to Drive
      const driveData = await uploadFileToDrive(file.uri, file.name, file.mimeType || 'application/epub+zip', providerToken, finalFolderId || undefined);

      // 2. Trigger Edge Function to process metadata and save to DB
      const folderTags = targetFolderName ? [targetFolderName] : [];
      const { error } = await supabase.functions.invoke('process-ebook', {
        body: { driveFileId: driveData.id, fileName: file.name, folderTags }
      });

      if (error) throw new Error(error.message);

      Alert.alert('Success', `Uploaded ${file.name}!`);
      onSuccess();
    } catch (e: any) {
      Alert.alert('Upload Error', e.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const uploadNode = (
    <FolderPickerModal
      visible={pickerVisible}
      onClose={() => setPickerVisible(false)}
      onSelectFolder={handleFolderSelected}
    />
  );

  return { startUpload, isUploading, uploadNode };
}
