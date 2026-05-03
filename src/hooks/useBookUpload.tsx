import React, { useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { uploadFileToDrive, getOrCreateFolder } from '../utils/drive';
import { withGoogleAccessTokenRetry } from '../utils/googleAuth';
import { supabase } from '../utils/supabase';
import FolderPickerModal from '../components/FolderPickerModal';

export function useBookUpload(onSuccess: () => void) {
  const [isUploading, setIsUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null);

  const startUpload = async (defaultCollectionName?: string | null) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/pdf', 'application/x-mobipocket-ebook', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];

      // 1. Validate File Extension
      const supportedExtensions = ['epub', 'mobi', 'pdf'];
      const fileExt = file.name?.split('.').pop()?.toLowerCase() || '';
      
      if (!supportedExtensions.includes(fileExt)) {
        Alert.alert('Unsupported Format', 'Please select an EPUB, MOBI, or PDF file.');
        return;
      }

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
      const rootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
      const driveData = await withGoogleAccessTokenRetry(async (providerToken) => {
        let finalFolderId = targetFolderId;

        // If we only have a targetFolderName (because of direct contextual upload), resolve the ID
        if (!finalFolderId && targetFolderName && rootId) {
          const folder = await getOrCreateFolder(targetFolderName, providerToken, rootId);
          finalFolderId = folder.id;
        }

        // 1. Upload to Drive
        return uploadFileToDrive(
          file.uri,
          file.name,
          file.mimeType || 'application/epub+zip',
          providerToken,
          finalFolderId || undefined
        );
      });

      // 2. Trigger Edge Function to process metadata and save to DB
      const folderTags = targetFolderName ? [targetFolderName] : [];
      const { error } = await supabase.functions.invoke('process-ebook', {
        body: {
          driveFileId: driveData.id,
          fileName: file.name,
          folderTags,
          driveUploadedAt: driveData.createdTime || null,
        }
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
