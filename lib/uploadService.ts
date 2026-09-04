import { ImagePickerAsset } from 'expo-image-picker';
import { DocumentPickerAsset } from 'expo-document-picker';
import { supabase } from './supabase';
import { UploadPurpose, recordUploadedFile } from './uploadAnalysis';

import { hasSupabase } from './publicEnv';

export type AppUpload = {
  publicUrl: string;
  bucketId: string;
  objectPath: string;
  fileName: string;
  mimeType: string;
};

export async function uploadPickedAsset(input: {
  asset: ImagePickerAsset;
  bucketId: string;
  purpose: UploadPurpose;
  pathPrefix?: string;
  relatedTable?: string;
  relatedId?: string;
}): Promise<AppUpload> {
  if (!hasSupabase) throw new Error('Supabase is not configured for uploads.');

  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  if (!userId) throw new Error('Sign in before uploading files.');

  const mimeType = input.asset.mimeType || inferMimeType(input.asset.fileName, input.asset.type);
  const fileName = sanitizeFileName(input.asset.fileName || `${input.purpose}.${extensionFromMime(mimeType)}`);
  const objectPath = `${input.pathPrefix || userId}/${Date.now()}-${fileName}`;
  const response = await fetch(input.asset.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from(input.bucketId)
    .upload(objectPath, blob, {
      contentType: mimeType,
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const publicUrl = await getReachableStorageUrl(input.bucketId, objectPath);

  await recordUploadedFile({
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: input.asset.fileSize,
    purpose: input.purpose,
    relatedTable: input.relatedTable,
    relatedId: input.relatedId,
  });

  return { publicUrl, bucketId: input.bucketId, objectPath, fileName, mimeType };
}

export async function uploadDocumentAsset(input: {
  asset: DocumentPickerAsset;
  bucketId: string;
  purpose: UploadPurpose;
  pathPrefix?: string;
  relatedTable?: string;
  relatedId?: string;
}): Promise<AppUpload> {
  if (!hasSupabase) throw new Error('Supabase is not configured for uploads.');

  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  if (!userId) throw new Error('Sign in before uploading files.');

  const mimeType = input.asset.mimeType || inferMimeType(input.asset.name);
  const fileName = sanitizeFileName(input.asset.name || `${input.purpose}.${extensionFromMime(mimeType)}`);
  const objectPath = `${input.pathPrefix || userId}/${Date.now()}-${fileName}`;
  const response = await fetch(input.asset.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from(input.bucketId)
    .upload(objectPath, blob, {
      contentType: mimeType,
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const publicUrl = await getReachableStorageUrl(input.bucketId, objectPath);

  await recordUploadedFile({
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: input.asset.size,
    purpose: input.purpose,
    relatedTable: input.relatedTable,
    relatedId: input.relatedId,
  });

  return { publicUrl, bucketId: input.bucketId, objectPath, fileName, mimeType };
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

async function getReachableStorageUrl(bucketId: string, objectPath: string) {
  const publicBuckets = new Set(['app-assets', 'story-media', 'profile-avatars']);
  if (publicBuckets.has(bucketId)) {
    const { data } = supabase.storage.from(bucketId).getPublicUrl(objectPath);
    return data.publicUrl;
  }

  const { data, error } = await supabase.storage
    .from(bucketId)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) throw error || new Error('Unable to create a secure file link.');
  return data.signedUrl;
}

function inferMimeType(fileName?: string | null, type?: string | null) {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp4') || type === 'video') return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.zip')) return 'application/zip';
  return type === 'video' ? 'video/mp4' : 'image/jpeg';
}

function extensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'video/mp4') return 'mp4';
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/aac') return 'aac';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/epub+zip') return 'epub';
  if (mimeType === 'application/msword') return 'doc';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mimeType === 'application/vnd.ms-powerpoint') return 'ppt';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (mimeType === 'text/plain') return 'txt';
  if (mimeType === 'application/zip') return 'zip';
  return 'jpg';
}
