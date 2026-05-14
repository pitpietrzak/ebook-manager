import React, { useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { uploadFileToDrive, getOrCreateFolder } from '../utils/drive';
import { withGoogleAccessTokenRetry } from '../utils/googleAuth';
import { invokeEdgeFunctionWithRetry } from '../utils/supabaseFunctions';
import FolderPickerModal from '../components/FolderPickerModal';

export const SUPPORTED_BOOK_EXTENSIONS = ['epub', 'mobi', 'azw3', 'pdf'] as const;
export const SUPPORTED_BOOK_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
] as const;

export function useBookUpload(onSuccess: () => void) {
  const [isUploading, setIsUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null);

  const startUpload = async (defaultCollectionName?: string | null) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...SUPPORTED_BOOK_TYPES],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];

      // 1. Validate File Extension
      const fileExt = file.name?.split('.').pop()?.toLowerCase() || '';
      
      if (!SUPPORTED_BOOK_EXTENSIONS.includes(fileExt as any)) {
        Alert.alert('Unsupported Format', 'Please select an EPUB, MOBI, AZW3, or PDF file.');
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
      let providerTokenForProcessing = '';

      const driveData = await withGoogleAccessTokenRetry(async (providerToken) => {
        providerTokenForProcessing = providerToken;
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
      const folderTags = targetFolderName ? [targetFolderName.trim()] : [];
      const { error } = await withGoogleAccessTokenRetry((providerToken) =>
        invokeEdgeFunctionWithRetry('process-ebook', {
          body: {
            driveFileId: driveData.id,
            fileName: file.name,
            folderTags,
            driveUploadedAt: driveData.createdTime || null,
            providerToken: providerTokenForProcessing || providerToken,
          }
        })
      );

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
