import { Platform } from 'react-native';

export const uploadFileToDrive = async (
  fileUri: string,
  fileName: string,
  mimeType: string,
  accessToken: string
) => {
  try {
    const formData = new FormData();
    const sharedFolderId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
    // Metadata part
    const metadata: any = {
      name: fileName,
      mimeType: mimeType,
    };
    
    if (sharedFolderId) {
      metadata.parents = [sharedFolderId];
    }
    
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    
    // File part
    // React Native FormData accepts a specific object for files
    const fileToUpload = {
      uri: Platform.OS === 'ios' ? fileUri.replace('file://', '') : fileUri,
      type: mimeType,
      name: fileName,
    } as any;
    
    formData.append('file', fileToUpload);

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // React Native fetch will automatically set the correct multipart boundary
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Drive API error: ${errorText}`);
    }

    const data = await response.json();
    return data; // contains id, name, mimeType
  } catch (err) {
    console.error('Error uploading to Google Drive:', err);
    throw err;
  }
};
