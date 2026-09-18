import { File, UploadType } from 'expo-file-system';
import { DocumentPickerAsset } from 'expo-document-picker';
import { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

import { hasSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './publicEnv';
import { supabase } from './supabase';
import { UploadPurpose, recordUploadedFile } from './uploadAnalysis';
import {
  AVATAR_IMAGE_MAX_EDGE,
  CONTENT_IMAGE_MAX_EDGE,
  UploadError,
  assertWithinBucketLimit,
  bucketSizeLimit,
  isImageMime,
  localFileSize,
  prepareImageForUpload,
  readUploadBody,
} from './uploadBody';
import { createTransferWatchdog, isAbortError, uploadTimeoutMs } from './requestTimeout';

export {
  BUCKET_SIZE_LIMITS,
  UploadError,
  bucketSizeLimit,
  formatBytes,
  friendlyUploadError,
  isUploadError,
  tooLargeMessage,
} from './uploadBody';
export type { PreparedUpload, UploadErrorKind } from './uploadBody';

/*
 * The upload core.
 *
 * The old path read the whole file into a JavaScript ArrayBuffer, which React
 * Native then base64-encoded on the JS thread before a single byte left the
 * phone. That is the five-to-ten-minute wait with no progress. This path shrinks
 * a photo first, then streams the file straight off disk to Supabase Storage
 * with expo-file-system's UploadTask, reporting real bytes as they go out.
 */

/** Called as bytes leave the phone. `fraction` runs from 0 to 1. */
export type UploadProgressHandler = (fraction: number) => void;

export type AppUpload = {
  publicUrl: string;
  bucketId: string;
  objectPath: string;
  fileName: string;
  mimeType: string;
  /** Bytes actually sent, after any downscaling. 0 when it could not be measured. */
  sizeBytes: number;
  /** Pixel size of the image that was sent, when the file is an image. */
  width?: number;
  height?: number;
};

/** How hard to shrink a picked image before sending it. */
export type ResizeMode = 'content' | 'avatar' | 'none';

/** Beyond this size we never fall back to the in-memory path; it would stall the phone. */
const IN_MEMORY_FALLBACK_LIMIT = 6 * 1024 * 1024;

type ResolvedSession = { userId: string; accessToken: string };

/**
 * The signed-in user, read from local storage.
 *
 * auth.getUser() is a network round trip that also takes the auth lock, and the
 * old path made three of them per story post. getSession() reads the session
 * that is already on the device. Row-level security still decides what the
 * upload is allowed to do, so nothing is weakened by trusting it here.
 */
async function resolveSession(): Promise<ResolvedSession> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.user?.id || !session.access_token) {
    throw new UploadError('Please sign in before uploading files.', 'auth');
  }
  return { userId: session.user.id, accessToken: session.access_token };
}

/** The signed-in user id without a network call, or null when signed out. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

function storageObjectUrl(bucketId: string, objectPath: string): string {
  const encoded = `${bucketId}/${objectPath}`
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${SUPABASE_URL}/storage/v1/object/${encoded}`;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function messageForStatus(status: number, bucketId: string, body: string): UploadError {
  if (status === 401) return new UploadError('Your session has expired. Please sign in again, then try once more.', 'auth');
  if (status === 403) return new UploadError('Your account does not have permission to upload here yet.', 'permission');
  if (status === 413) {
    return new UploadError('That file was larger than the app currently accepts here. Please choose a smaller one and try again.', 'too-large');
  }
  if (status === 415) return new UploadError('That kind of file cannot go here. Try a photo, a video or a PDF.', 'unsupported');
  if (status === 409) return new UploadError('A file with that name is already saved. Please try again.', 'unknown');
  if (status === 429) return new UploadError('The server is busy right now. Please wait a moment and try again.', 'network');
  if (status >= 500) return new UploadError('The file server had a problem. Please try again in a moment.', 'network');
  const detail = parseStorageMessage(body);
  return new UploadError(detail || `That upload did not go through (${status}). Please try again.`, 'unknown');
}

function parseStorageMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : '';
    // Storage speaks in server language; only pass through something a person can use.
    if (/payload too large|exceeded the maximum allowed size/i.test(message)) {
      return 'That file was larger than the app currently accepts here. Please choose a smaller one and try again.';
    }
    if (/mime type .* is not supported/i.test(message)) {
      return 'That kind of file cannot go here. Try a photo, a video or a PDF.';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Stream one local file into a Supabase Storage bucket.
 *
 * Nothing is loaded into the JavaScript heap: expo-file-system hands the file
 * URL to the native HTTP stack, which reads it from disk as it sends. Progress
 * is reported from native as real bytes on the wire.
 */
export async function uploadFileToBucket(input: {
  uri: string;
  bucketId: string;
  objectPath: string;
  mimeType: string;
  /** Pass the size when you already know it; it sizes the timeout. */
  sizeBytes?: number;
  upsert?: boolean;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
  /** Pass the token you already read, so this does not look the session up again. */
  accessToken?: string;
}): Promise<{ objectPath: string; sizeBytes: number }> {
  if (!hasSupabase) throw new UploadError('File uploads are not set up in this build yet.', 'unsupported');

  const upsert = input.upsert !== false;
  const knownSize = input.sizeBytes && input.sizeBytes > 0 ? input.sizeBytes : localFileSize(input.uri);
  assertWithinBucketLimit(input.bucketId, knownSize);

  if (Platform.OS === 'web') {
    return uploadThroughSupabaseClient({ ...input, upsert, maxBytes: bucketSizeLimit(input.bucketId) });
  }

  const file = new File(input.uri);
  if (!file.exists) throw new UploadError('We could not find that file on your phone any more. Please pick it again.', 'missing');
  const sizeBytes = file.size || knownSize;
  assertWithinBucketLimit(input.bucketId, sizeBytes);

  const accessToken = input.accessToken || (await resolveSession()).accessToken;
  const watchdog = createTransferWatchdog({ overallMs: uploadTimeoutMs(sizeBytes), signal: input.signal });
  input.onProgress?.(0);

  try {
    const result = await file.upload(storageObjectUrl(input.bucketId, input.objectPath), {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      // For a binary upload the native side sets no content type of its own,
      // so this header is the only thing telling Storage what it is receiving.
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        'content-type': input.mimeType,
        'cache-control': 'max-age=3600',
        'x-upsert': String(upsert),
      },
      signal: watchdog.signal,
      onProgress: ({ bytesSent, totalBytes }) => {
        watchdog.touch();
        const total = totalBytes > 0 ? totalBytes : sizeBytes;
        if (total > 0) input.onProgress?.(clampFraction(bytesSent / total));
      },
    });

    if (result.status < 200 || result.status >= 300) throw messageForStatus(result.status, input.bucketId, result.body);
    input.onProgress?.(1);
    return { objectPath: input.objectPath, sizeBytes };
  } catch (error) {
    const fired = watchdog.firedAs();
    if (fired === 'stall') {
      throw new UploadError('That upload stopped partway — the connection dropped out. Please try again, ideally on Wi-Fi.', 'timeout');
    }
    if (fired === 'overall') {
      throw new UploadError('That file is taking too long on this connection. Please try again on Wi-Fi.', 'timeout');
    }
    if (input.signal?.aborted) throw new UploadError('Upload cancelled.', 'cancelled');
    if (error instanceof UploadError) throw error;
    if (isAbortError(error)) throw new UploadError('That upload was stopped before it finished. You can start it again whenever you are ready.', 'cancelled');

    // A small file can safely go the old in-memory way if streaming fails for
    // a reason we did not anticipate on this device. A large one cannot — that
    // is the base64 path that made this slow in the first place.
    // Message only — never the error object, which could echo request headers.
    console.warn('Streaming upload failed:', error instanceof Error ? error.message : 'unknown error');
    if (sizeBytes > 0 && sizeBytes <= IN_MEMORY_FALLBACK_LIMIT) {
      return uploadThroughSupabaseClient({ ...input, upsert, maxBytes: IN_MEMORY_FALLBACK_LIMIT });
    }
    throw new UploadError('That upload did not go through. Please check your connection and try again.', 'network');
  } finally {
    watchdog.stop();
  }
}

/** The original buffer-and-post path. Web uses it always; phones only as a safety net. */
async function uploadThroughSupabaseClient(input: {
  uri: string;
  bucketId: string;
  objectPath: string;
  mimeType: string;
  maxBytes: number;
  upsert?: boolean;
  onProgress?: UploadProgressHandler;
}): Promise<{ objectPath: string; sizeBytes: number }> {
  input.onProgress?.(0);
  const body = await readUploadBody(input.uri, input.maxBytes);
  const { error } = await supabase.storage
    .from(input.bucketId)
    .upload(input.objectPath, body.body, { contentType: input.mimeType, upsert: input.upsert !== false });
  if (error) {
    const status = Number((error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status ?? 0);
    throw status ? messageForStatus(status, input.bucketId, '') : error;
  }
  input.onProgress?.(1);
  return { objectPath: input.objectPath, sizeBytes: body.size };
}

function resizeModeFor(purpose: UploadPurpose, requested?: ResizeMode): ResizeMode {
  if (requested) return requested;
  return purpose === 'profile_avatar' ? 'avatar' : 'content';
}

function maxEdgeFor(mode: ResizeMode): number | null {
  if (mode === 'none') return null;
  return mode === 'avatar' ? AVATAR_IMAGE_MAX_EDGE : CONTENT_IMAGE_MAX_EDGE;
}

export async function uploadPickedAsset(input: {
  asset: ImagePickerAsset;
  bucketId: string;
  purpose: UploadPurpose;
  pathPrefix?: string;
  relatedTable?: string;
  relatedId?: string;
  /** Optional. Called with 0 to 1 as bytes leave the phone. */
  onProgress?: UploadProgressHandler;
  /** Optional. Abort to cancel the upload. */
  signal?: AbortSignal;
  /** Optional. Overrides the shrink rule chosen from the purpose. */
  resize?: ResizeMode;
}): Promise<AppUpload> {
  if (!hasSupabase) throw new UploadError('File uploads are not set up in this build yet.', 'unsupported');

  const declaredMime = input.asset.mimeType || inferMimeType(input.asset.fileName, input.asset.type);
  const maxEdge = maxEdgeFor(resizeModeFor(input.purpose, input.resize));

  // The session read and the photo shrink do not depend on each other.
  const [session, prepared] = await Promise.all([
    resolveSession(),
    maxEdge && isImageMime(declaredMime)
      ? prepareImageForUpload({
          uri: input.asset.uri,
          mimeType: declaredMime,
          width: input.asset.width,
          height: input.asset.height,
          maxEdge,
        })
      : Promise.resolve({
          uri: input.asset.uri,
          mimeType: declaredMime,
          sizeBytes: localFileSize(input.asset.uri),
          width: input.asset.width,
          height: input.asset.height,
          wasResized: false,
        }),
  ]);

  const mimeType = prepared.mimeType || declaredMime;
  const fileName = sanitizeFileName(renameForMime(input.asset.fileName, mimeType, prepared.wasResized) || `${input.purpose}.${extensionFromMime(mimeType)}`);
  const objectPath = `${input.pathPrefix || session.userId}/${Date.now()}-${fileName}`;

  const stored = await uploadFileToBucket({
    uri: prepared.uri,
    bucketId: input.bucketId,
    objectPath,
    mimeType,
    sizeBytes: prepared.sizeBytes,
    accessToken: session.accessToken,
    onProgress: input.onProgress,
    signal: input.signal,
  });

  const publicUrl = await getReachableStorageUrl(input.bucketId, objectPath);

  noteUploadedFile({
    ownerId: session.userId,
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: stored.sizeBytes,
    purpose: input.purpose,
    relatedTable: input.relatedTable,
    relatedId: input.relatedId,
  });

  return {
    publicUrl,
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: stored.sizeBytes,
    width: prepared.width,
    height: prepared.height,
  };
}

export async function uploadDocumentAsset(input: {
  asset: DocumentPickerAsset;
  bucketId: string;
  purpose: UploadPurpose;
  pathPrefix?: string;
  relatedTable?: string;
  relatedId?: string;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
  resize?: ResizeMode;
}): Promise<AppUpload> {
  if (!hasSupabase) throw new UploadError('File uploads are not set up in this build yet.', 'unsupported');

  const declaredMime = input.asset.mimeType || inferMimeType(input.asset.name);
  const maxEdge = maxEdgeFor(resizeModeFor(input.purpose, input.resize));

  const [session, prepared] = await Promise.all([
    resolveSession(),
    maxEdge && isImageMime(declaredMime)
      ? prepareImageForUpload({ uri: input.asset.uri, mimeType: declaredMime, maxEdge })
      : Promise.resolve({
          uri: input.asset.uri,
          mimeType: declaredMime,
          sizeBytes: input.asset.size || localFileSize(input.asset.uri),
          width: undefined,
          height: undefined,
          wasResized: false,
        }),
  ]);

  const mimeType = prepared.mimeType || declaredMime;
  const fileName = sanitizeFileName(renameForMime(input.asset.name, mimeType, prepared.wasResized) || `${input.purpose}.${extensionFromMime(mimeType)}`);
  const objectPath = `${input.pathPrefix || session.userId}/${Date.now()}-${fileName}`;

  const stored = await uploadFileToBucket({
    uri: prepared.uri,
    bucketId: input.bucketId,
    objectPath,
    mimeType,
    sizeBytes: prepared.sizeBytes || input.asset.size || 0,
    accessToken: session.accessToken,
    onProgress: input.onProgress,
    signal: input.signal,
  });

  const publicUrl = await getReachableStorageUrl(input.bucketId, objectPath);

  noteUploadedFile({
    ownerId: session.userId,
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: stored.sizeBytes,
    purpose: input.purpose,
    relatedTable: input.relatedTable,
    relatedId: input.relatedId,
  });

  return {
    publicUrl,
    bucketId: input.bucketId,
    objectPath,
    fileName,
    mimeType,
    sizeBytes: stored.sizeBytes,
    width: prepared.width,
    height: prepared.height,
  };
}

/**
 * Bookkeeping into `uploaded_files`. Nothing on screen reads those rows — only
 * an admin count — so it must never sit between the person and their photo.
 */
function noteUploadedFile(input: Parameters<typeof recordUploadedFile>[0]) {
  void recordUploadedFile(input).catch((error) => {
    console.warn('uploaded_files bookkeeping did not save', error);
  });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

/** A shrunk HEIC arrives as a JPEG, so the name has to follow the bytes. */
function renameForMime(fileName: string | null | undefined, mimeType: string, wasResized: boolean): string {
  const name = fileName || '';
  if (!wasResized || !name) return name;
  const extension = extensionFromMime(mimeType);
  const base = name.replace(/\.[^.]+$/, '') || 'photo';
  return `${base}.${extension}`;
}

export async function getReachableStorageUrl(bucketId: string, objectPath: string) {
  // chat-attachments, outreach-private and prayer-attachments are private on
  // purpose and are read through signed links. Never add them to this set.
  const publicBuckets = new Set(['app-assets', 'story-media', 'profile-avatars']);
  if (publicBuckets.has(bucketId)) {
    const { data } = supabase.storage.from(bucketId).getPublicUrl(objectPath);
    return data.publicUrl;
  }

  const { data, error } = await supabase.storage
    .from(bucketId)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) throw error || new UploadError('We could not create a secure link for that file.', 'unknown');
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
