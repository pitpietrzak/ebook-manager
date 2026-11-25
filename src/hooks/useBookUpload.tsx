import React, { useState } from 'react';
import {  } from 'react-native';
import { showAlert } from '../utils/alert';
import * as DocumentPicker from 'expo-document-picker';
import { uploadFileToDrive, getOrCreateFolder } from '../utils/drive';
import { withGoogleAccessTokenRetry } from '../utils/googleAuth';
import { invokeEdgeFunctionWithRetry } from '../utils/supabaseFunctions';
import FolderPickerModal from '../components/FolderPickerModal';
import SeriesAssignmentModal from '../components/SeriesAssignmentModal';

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
  const [seriesModalVisible, setSeriesModalVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<any>(null);
  const [pendingTargetFolderId, setPendingTargetFolderId] = useState<string | null>(null);
  const [pendingTargetFolderName, setPendingTargetFolderName] = useState<string | undefined>(undefined);

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
        showAlert('Unsupported Format', 'Please select an EPUB, MOBI, AZW3, or PDF file.');
        return;
      }

      setPendingFile(file);

      if (defaultCollectionName && defaultCollectionName !== '__uncategorised__') {
        setPendingTargetFolderId(null);
        setPendingTargetFolderName(defaultCollectionName);
        setSeriesModalVisible(true);
      } else {
        // Needs folder selection first
        setPickerVisible(true);
      }
    } catch (e: any) {
      showAlert('Error', e.message || 'Could not pick file');
    }
  };

  const handleFolderSelected = async (targetFolderId: string | null, targetFolderName?: string) => {
    setPickerVisible(false);
    if (!pendingFile) return;
    setPendingTargetFolderId(targetFolderId);
    setPendingTargetFolderName(targetFolderName);
    setSeriesModalVisible(true);
  };

  const continueWithSeries = async (seriesName: string, seriesPart: number | null) => {
    if (!pendingFile) {
      setSeriesModalVisible(false);
      return;
    }

    const file = pendingFile;
    const targetFolderId = pendingTargetFolderId;
    const targetFolderName = pendingTargetFolderName;

    setPendingFile(null);
    setPendingTargetFolderId(null);
    setPendingTargetFolderName(undefined);
    setSeriesModalVisible(false);

    await executeUpload(file, targetFolderId, targetFolderName, seriesName, seriesPart);
  };

  const cancelPendingUpload = () => {
    setSeriesModalVisible(false);
    setPendingFile(null);
    setPendingTargetFolderId(null);
    setPendingTargetFolderName(undefined);
  };

  const executeUpload = async (
    file: any,
    targetFolderId: string | null,
    targetFolderName?: string,
    seriesName?: string,
    seriesPart?: number | null
  ) => {
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
            ...(seriesName?.trim() ? { seriesName: seriesName.trim() } : {}),
            ...(seriesName?.trim() ? { seriesPart: seriesPart || null } : {}),
          }
        })
      );

      if (error) throw new Error(error.message);

      showAlert('Success', `Uploaded ${file.name}!`);
      onSuccess();
    } catch (e: any) {
      showAlert('Upload Error', e.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const uploadNode = (
    <>
      <FolderPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelectFolder={handleFolderSelected}
      />
      <SeriesAssignmentModal
        visible={seriesModalVisible}
        title="Assign Series (Optional)"
        onCancel={cancelPendingUpload}
        onSave={({ seriesName, seriesPart }) => continueWithSeries(seriesName, seriesPart)}
        saveLabel="Upload"
        skipLabel="No Series"
      />
    </>
  );

  return { startUpload, isUploading, uploadNode };
}
