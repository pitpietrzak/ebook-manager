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

    // Step 2: Upload the actual file binary. On web the picker gives a
    // blob: URL, which we read into a Blob; native fetch accepts the
    // {uri,type,name} file descriptor directly.
    const fileToUpload: any = Platform.OS === 'web'
      ? await (await fetch(fileUri)).blob()
      : {
          uri: Platform.OS === 'ios' ? fileUri.replace('file://', '') : fileUri,
          type: mimeType,
          name: fileName,
        };
    
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

export const moveDriveFileToFolder = async (
  fileId: string,
  accessToken: string,
  targetFolderId?: string | null
) => {
  try {
    const fallbackRootId = process.env.EXPO_PUBLIC_SHARED_FOLDER_ID;
    const destinationFolderId = targetFolderId || fallbackRootId;

    if (!destinationFolderId) {
      throw new Error('Destination folder is missing');
    }

    const metaResponse = await fetch(
      `${BASE_URL}/${fileId}?fields=parents&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!metaResponse.ok) {
      const errorText = await metaResponse.text();
      throw new Error(`Google Drive move precheck failed (${metaResponse.status}): ${errorText}`);
    }

    const meta = await metaResponse.json();
    const currentParents: string[] = Array.isArray(meta?.parents) ? meta.parents : [];
    const removeParents = currentParents.filter((parentId) => parentId !== destinationFolderId).join(',');

    const params = new URLSearchParams();
    params.set('addParents', destinationFolderId);
    if (removeParents) params.set('removeParents', removeParents);
    params.set('fields', 'id,parents');
    params.set('supportsAllDrives', 'true');

    const moveResponse = await fetch(`${BASE_URL}/${fileId}?${params.toString()}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!moveResponse.ok) {
      const errorText = await moveResponse.text();
      throw new Error(`Google Drive move failed (${moveResponse.status}): ${errorText}`);
    }

    return await moveResponse.json();
  } catch (err) {
    console.error('Error moving file in Google Drive:', err);
    throw err;
  }
};
