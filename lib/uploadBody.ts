import { File } from 'expo-file-system';
import { Platform } from 'react-native';

// React Native's fetch(uri).blob() is not a supported Supabase upload body.
// Read the selected file as bytes on phones; keep browser Blob support on web.
export async function readUploadBody(uri: string, maxBytes = 50 * 1024 * 1024) {
  if (Platform.OS !== 'web') {
    const file = new File(uri);
    if (file.size > maxBytes) throw new Error('Choose a file smaller than 50 MB.');
    const body = await file.arrayBuffer();
    if (!body.byteLength) throw new Error('The selected file is empty.');
    if (body.byteLength > maxBytes) throw new Error('Choose a file smaller than 50 MB.');
    return { body, size: body.byteLength };
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read the selected file.');
  const body = await response.blob();
  if (!body.size) throw new Error('The selected file is empty.');
  if (body.size > maxBytes) throw new Error('Choose a file smaller than 50 MB.');
  return { body, size: body.size };
}
