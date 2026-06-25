import { supabase } from './supabase';

export type UploadPurpose =
  | 'profile_avatar'
  | 'story'
  | 'media_thumbnail'
  | 'media_file'
  | 'chat_attachment'
  | 'prayer_attachment'
  | 'app_asset'
  | 'outreach_file';

export type UploadedFileInput = {
  bucketId: string;
  objectPath: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  purpose: UploadPurpose;
  relatedTable?: string;
  relatedId?: string;
};

export function analyzeUploadedFile(input: UploadedFileInput) {
  const mimeType = input.mimeType || '';
  const family = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : mimeType === 'application/pdf'
          ? 'document'
          : 'unknown';

  return {
    family,
    bucketId: input.bucketId,
    objectPath: input.objectPath,
    fileName: input.fileName || input.objectPath.split('/').pop() || 'upload',
    purpose: input.purpose,
    isPreviewable: family === 'image' || family === 'video' || family === 'audio' || family === 'document',
    needsModerationReview: input.purpose === 'chat_attachment' || input.purpose === 'story' || input.purpose === 'media_file',
    recommendedTable: input.relatedTable || recommendedTable(input.purpose),
    createdAt: new Date().toISOString()
  };
}

export async function recordUploadedFile(input: UploadedFileInput) {
  const analysis = analyzeUploadedFile(input);
  const { data: userResult } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('uploaded_files')
    .insert({
      owner_id: userResult.user?.id || null,
      bucket_id: input.bucketId,
      object_path: input.objectPath,
      file_name: input.fileName || analysis.fileName,
      mime_type: input.mimeType || null,
      size_bytes: input.sizeBytes || null,
      purpose: input.purpose,
      related_table: input.relatedTable || null,
      related_id: input.relatedId || null,
      analysis
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

function recommendedTable(purpose: UploadPurpose) {
  if (purpose === 'profile_avatar') return 'profiles';
  if (purpose === 'story') return 'app_stories';
  if (purpose === 'media_thumbnail' || purpose === 'media_file') return 'media_items';
  if (purpose === 'chat_attachment') return 'chat_attachments';
  if (purpose === 'prayer_attachment') return 'prayer_request_attachments';
  if (purpose === 'outreach_file') return 'outreach_contacts';
  return 'app_settings';
}
