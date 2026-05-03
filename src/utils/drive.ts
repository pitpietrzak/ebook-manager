import { Platform } from 'react-native';

const BASE_URL = 'https://www.googleapis.com/drive/v3/files';

export const listDriveFolders = async (accessToken: string, parentId: string) => {
  try {
    const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const response = await fetch(`${BASE_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.files || [];
  } catch (err) {
    console.error('Error listing folders:', err);
    throw err;
  }
};

export const searchDriveFolder = async (name: string, accessToken: string, parentId: string) => {
  try {
    const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const response = await fetch(`${BASE_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  } catch (err) {
    console.error('Error searching folder:', err);
    throw err;
  }
};

export const createDriveFolder = async (name: string, accessToken: string, parentId: string) => {
  try {
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    };
    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Error creating folder:', err);
    throw err;
  }
};

export const getOrCreateFolder = async (name: string, accessToken: string, parentId: string) => {
  let folder = await searchDriveFolder(name, accessToken, parentId);
  if (!folder) {
    folder = await createDriveFolder(name, accessToken, parentId);
  }
  return folder;
};

export const uploadFileToDrive = async (
  fileUri: string,
  fileName: string,
  mimeType: string,
  accessToken: string,
  targetFolderId?: string
) => {
  try {
    const folderId = targetFolderId || process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
    
    const metadata: any = {
      name: fileName,
      mimeType: mimeType,
    };
    
    if (folderId) {
      metadata.parents = [folderId];
    }
    
    // Step 1: Initiate a resumable upload session
    const initResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,createdTime',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      throw new Error(`Google Drive Init error: ${errorText}`);
    }

    const uploadUrl = initResponse.headers.get('Location');
    if (!uploadUrl) throw new Error('No upload URL returned from Google Drive');

    // Step 2: Upload the actual file binary
    const fileToUpload = {
      uri: Platform.OS === 'ios' ? fileUri.replace('file://', '') : fileUri,
      type: mimeType,
      name: fileName,
    } as any;
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: fileToUpload,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Google Drive Upload error: ${errorText}`);
    }

    const data = await uploadResponse.json();
    return data; 
  } catch (err) {
    console.error('Error uploading to Google Drive:', err);
    throw err;
  }
};
