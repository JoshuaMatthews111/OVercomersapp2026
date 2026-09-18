import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageManipulatorContext, ImageRef } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { friendlyError } from './errorMessages';
import { fetchWithTimeout, isAbortError } from './requestTimeout';

/*
 * Getting a file ready to leave the phone.
 *
 * Two jobs live here. First, shrink a photo before a single byte goes out — a
 * 12 megapixel picture is four to eight megabytes and nobody needs that on a
 * phone screen. Second, know what each bucket will actually accept, so a file
 * that is too big is refused here, kindly and instantly, instead of failing
 * three minutes later with a server error nobody can read.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Longest edge for a photo in a story, a chat message, a cover or a flyer. */
export const CONTENT_IMAGE_MAX_EDGE = 2048;

/** Longest edge for a profile picture. It is never shown larger than a circle. */
export const AVATAR_IMAGE_MAX_EDGE = 512;

/** JPEG quality kept high enough that a photo still looks like a photograph. */
export const IMAGE_QUALITY = 0.8;

/**
 * An image already within the size limit is only re-encoded when it is heavier
 * than this. Below it the saving is not worth the wait or the quality loss.
 */
export const IMAGE_RECOMPRESS_ABOVE_BYTES = 1.5 * MB;

/**
 * What each bucket really accepts, from the live database on 2026-09-18.
 *
 * chat-attachments is listed at its NEW limit. A migration raising that bucket
 * from 50 MB to 500 MB is landing alongside this change; until it does, a file
 * over 50 MB will be refused by the server with a 413 and the person is told so
 * in plain words rather than being left waiting.
 */
export const BUCKET_SIZE_LIMITS: Record<string, number> = {
  'app-assets': 1 * GB,
  'story-media': 1 * GB,
  'sermon-media': 500 * MB,
  'chat-attachments': 500 * MB,
  'ogn-public': 10 * MB,
  'profile-avatars': 5 * MB,
  'outreach-private': 20 * MB,
  'prayer-attachments': 20 * MB,
};

/** Used only for a bucket nobody has told us about yet. */
export const FALLBACK_BUCKET_LIMIT_BYTES = 50 * MB;

/**
 * Handing a picked file over inside the browser is local work, so it is quick
 * or it is broken. A minute is generous and still stops a spinner forever.
 */
const WEB_FILE_READ_TIMEOUT_MS = 60_000;

/** How each bucket is described to a person, never by its technical name. */
const BUCKET_LABELS: Record<string, string> = {
  'app-assets': 'the media library',
  'story-media': 'a story',
  'sermon-media': 'a sermon file',
  'chat-attachments': 'a chat message',
  'ogn-public': 'this gallery',
  'profile-avatars': 'a profile photo',
  'outreach-private': 'an outreach file',
  'prayer-attachments': 'a prayer attachment',
};

const BUCKET_HINTS: Record<string, string> = {
  'chat-attachments': 'A shorter clip usually does it.',
  'story-media': 'A shorter clip usually does it.',
  'profile-avatars': 'Almost any photo from your camera roll will fit.',
  'sermon-media': 'Try a shorter recording, or share it as a link instead.',
};

export type UploadErrorKind =
  | 'too-large'
  | 'empty'
  | 'missing'
  | 'timeout'
  | 'cancelled'
  | 'auth'
  | 'permission'
  | 'network'
  | 'unsupported'
  | 'unknown';

/**
 * An error whose message is already written for a person to read.
 *
 * friendlyError() rewrites anything it does not recognise, which would throw
 * this careful wording away, so upload paths should use friendlyUploadError().
 */
export class UploadError extends Error {
  readonly friendly = true;
  readonly kind: UploadErrorKind;

  constructor(message: string, kind: UploadErrorKind = 'unknown') {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
  }
}

/** True when this error already carries wording meant for a person. */
export function isUploadError(error: unknown): error is UploadError {
  return error instanceof UploadError || Boolean((error as { friendly?: unknown } | null)?.friendly);
}

/** Turn anything an upload can throw into one warm sentence. */
export function friendlyUploadError(error: unknown, fallback = 'That upload did not finish. Please try again.'): string {
  if (isUploadError(error)) return (error as Error).message;
  if (isAbortError(error)) return 'That upload was stopped before it finished. You can start it again whenever you are ready.';
  return friendlyError(error, fallback);
}

export function bucketSizeLimit(bucketId: string): number {
  return BUCKET_SIZE_LIMITS[bucketId] ?? FALLBACK_BUCKET_LIMIT_BYTES;
}

/** "4.2 MB", "860 KB", "1 GB" — the way a person would say it. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= GB) return `${trimDecimal(bytes / GB)} GB`;
  if (bytes >= MB) return `${trimDecimal(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function trimDecimal(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The sentence someone reads when their file will not fit. */
export function tooLargeMessage(bucketId: string, sizeBytes: number): string {
  const place = BUCKET_LABELS[bucketId] || 'this part of the app';
  const hint = BUCKET_HINTS[bucketId] || 'Please choose something smaller and try again.';
  const capacity = `${place.charAt(0).toUpperCase()}${place.slice(1)} can hold up to ${formatBytes(bucketSizeLimit(bucketId))}.`;
  const opener = sizeBytes > 0 ? `That file is ${formatBytes(sizeBytes)}.` : 'That file is too big.';
  return `${opener} ${capacity} ${hint}`;
}

/** Refuse an oversized file here, instantly, instead of after a long wait. */
export function assertWithinBucketLimit(bucketId: string, sizeBytes: number): void {
  if (sizeBytes > 0 && sizeBytes > bucketSizeLimit(bucketId)) {
    throw new UploadError(tooLargeMessage(bucketId, sizeBytes), 'too-large');
  }
}

export function isImageMime(mimeType?: string | null): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'));
}

/** GIFs animate and SVGs are drawings; re-encoding either one ruins it. */
function isResizableImage(uri: string, mimeType?: string | null): boolean {
  const mime = (mimeType || '').toLowerCase();
  const lowerUri = uri.toLowerCase();
  if (mime && !mime.startsWith('image/')) return false;
  if (!mime && !/\.(jpe?g|png|heic|heif|webp|bmp|tiff?)(\?|$)/.test(lowerUri)) return false;
  if (mime.includes('gif') || lowerUri.includes('.gif')) return false;
  if (mime.includes('svg') || lowerUri.includes('.svg')) return false;
  return true;
}

function looksLikePng(uri: string, mimeType?: string | null): boolean {
  return (mimeType || '').toLowerCase() === 'image/png' || uri.toLowerCase().includes('.png');
}

/**
 * iPhone HEIC. Several buckets only accept JPEG/PNG/WebP, and browsers cannot
 * draw HEIC at all, so one of these is always re-encoded rather than sent as-is.
 */
function looksLikeHeic(uri: string, mimeType?: string | null): boolean {
  const mime = (mimeType || '').toLowerCase();
  const lowerUri = uri.toLowerCase();
  return mime.includes('heic') || mime.includes('heif') || /\.hei[cf](\?|$)/.test(lowerUri);
}

/** The size of a local file in bytes, or 0 when we cannot tell (web). */
export function localFileSize(uri: string): number {
  if (Platform.OS === 'web') return 0;
  try {
    const file = new File(uri);
    return file.exists ? file.size || 0 : 0;
  } catch {
    return 0;
  }
}

export type PreparedUpload = {
  /** The file to send. The original when nothing needed doing. */
  uri: string;
  mimeType: string;
  /** Bytes on disk, or 0 on web where we cannot measure a picked file. */
  sizeBytes: number;
  width?: number;
  height?: number;
  /** True when this is a smaller copy rather than the original file. */
  wasResized: boolean;
  /**
   * A plain sentence worth showing beside a SUCCESSFUL upload — never an error.
   * Set when the photo could not be made smaller, or when the phone is short of
   * memory. Usually undefined; ignore it and nothing is lost.
   */
  notice?: string;
};

/** Shown when shrinking did not work and the full-size photo goes instead. */
export const FULL_SIZE_PHOTO_NOTICE = 'We could not make that photo smaller, so it may take a little longer to send.';

/** Shown when the phone would not give a decoded photo's memory back. */
export const LOW_MEMORY_NOTICE =
  'Your phone is low on memory right now. If the next photo will not send, close a few apps and try again.';

type Releasable = { release(): void } | null;

/**
 * Hand decoded bitmaps back to the platform.
 *
 * Each one holds a full-size image in memory, so they are let go before any
 * bytes move. Releasing detaches the JavaScript object from its native bitmap
 * and can refuse if the platform already reclaimed it — which is harmless in
 * itself, but says this phone is under memory pressure, and that is worth
 * passing back rather than swallowing. Returns false when any release refused.
 */
function releaseBitmaps(items: Releasable[]): boolean {
  let allReleased = true;
  for (const item of items) {
    if (!item) continue;
    try {
      item.release();
    } catch {
      allReleased = false;
    }
  }
  return allReleased;
}

/**
 * Shrink a photo before it is uploaded.
 *
 * Passing the picker's own `width`/`height` avoids a decode. A small image is
 * returned untouched — this never enlarges anything — and anything that is not
 * a still image is returned untouched too.
 */
export async function prepareImageForUpload(input: {
  uri: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  maxEdge?: number;
  quality?: number;
}): Promise<PreparedUpload> {
  const untouched = (notice?: string): PreparedUpload => ({
    uri: input.uri,
    mimeType: input.mimeType || '',
    sizeBytes: localFileSize(input.uri),
    width: input.width ?? undefined,
    height: input.height ?? undefined,
    wasResized: false,
    notice,
  });

  if (!isResizableImage(input.uri, input.mimeType)) return untouched();

  const maxEdge = input.maxEdge ?? CONTENT_IMAGE_MAX_EDGE;
  const quality = input.quality ?? IMAGE_QUALITY;
  const isHeic = looksLikeHeic(input.uri, input.mimeType);
  const keepPng = !isHeic && looksLikePng(input.uri, input.mimeType);
  const originalSize = localFileSize(input.uri);

  let probeContext: ImageManipulatorContext | null = null;
  let probed: ImageRef | null = null;
  let workContext: ImageManipulatorContext | null = null;
  let rendered: ImageRef | null = null;

  try {
    let sourceWidth = input.width ?? 0;
    let sourceHeight = input.height ?? 0;

    if (!(sourceWidth > 0 && sourceHeight > 0)) {
      probeContext = ImageManipulator.manipulate(input.uri);
      probed = await probeContext.renderAsync();
      sourceWidth = probed.width;
      sourceHeight = probed.height;
    }

    const longestEdge = Math.max(sourceWidth, sourceHeight);
    const needsResize = longestEdge > maxEdge;
    // A PNG re-encoded at the same size saves almost nothing, so leave it alone.
    // A HEIC is always converted, however small, so what we send is really JPEG.
    const needsRecompress = !needsResize && !keepPng && (isHeic || originalSize > IMAGE_RECOMPRESS_ABOVE_BYTES);
    if (!needsResize && !needsRecompress) return untouched();

    // Carry on from the already decoded image when we had to probe for its size.
    workContext = ImageManipulator.manipulate(probed ?? input.uri);
    if (needsResize) {
      workContext = sourceWidth >= sourceHeight ? workContext.resize({ width: maxEdge }) : workContext.resize({ height: maxEdge });
    }

    rendered = await workContext.renderAsync();
    const saved = await rendered.saveAsync({ compress: quality, format: keepPng ? SaveFormat.PNG : SaveFormat.JPEG });
    const savedSize = localFileSize(saved.uri);

    // Every decoded bitmap is handed back here, before the return, so nothing
    // is still holding a full-size image in memory while the file goes out —
    // and so a phone that refuses can say so on the result.
    const memoryIsHealthy = releaseBitmaps([rendered, workContext, probed, probeContext]);
    rendered = workContext = probed = probeContext = null;

    // Re-encoding can make a small, already-optimised file bigger. Keep the original then.
    if (!isHeic && originalSize > 0 && savedSize > 0 && savedSize >= originalSize && !needsResize) {
      return untouched(memoryIsHealthy ? undefined : LOW_MEMORY_NOTICE);
    }

    return {
      uri: saved.uri,
      mimeType: keepPng ? 'image/png' : 'image/jpeg',
      sizeBytes: savedSize,
      width: saved.width,
      height: saved.height,
      wasResized: true,
      notice: memoryIsHealthy ? undefined : LOW_MEMORY_NOTICE,
    };
  } catch (error) {
    // A photo that will not shrink is still a photo worth sending, so this is
    // never an error the person has to deal with — but it is not nothing
    // either: their upload is about to be slower than it should be, and the
    // caller is given a sentence that says so plainly.
    console.warn('Photo could not be made smaller:', error instanceof Error ? error.message : 'unknown problem');
    return untouched(FULL_SIZE_PHOTO_NOTICE);
  } finally {
    // Anything still held after an early return or a failure goes back now.
    releaseBitmaps([rendered, workContext, probed, probeContext]);
  }
}

/**
 * Read a picked file on the web into an upload body.
 *
 * WEB ONLY, AND DELIBERATELY SO. A browser Blob is a handle to bytes the
 * browser is already holding, so this hands the file over without copying it
 * through the JavaScript heap. On a phone nothing reads a file into memory at
 * all any more: uploadService streams it straight off disk with real progress.
 * That in-memory path was the mechanism behind the silent five-minute publish,
 * and it is gone rather than merely avoided — there is no longer any code here
 * that can materialise a whole video in the heap.
 */
export async function readUploadBody(uri: string, maxBytes = FALLBACK_BUCKET_LIMIT_BYTES): Promise<{ body: Blob; size: number }> {
  const tooBig = () => new UploadError(`That file is larger than ${formatBytes(maxBytes)}. Please choose a smaller one and try again.`, 'too-large');

  if (Platform.OS !== 'web') {
    // Nothing should ever reach this. If something does, say so plainly rather
    // than quietly loading the whole file into memory behind the person's back.
    throw new UploadError('This phone could not prepare that file to send. Please close the app, open it again and try once more.', 'unsupported');
  }

  const response = await fetchWithTimeout(uri, undefined, WEB_FILE_READ_TIMEOUT_MS);
  if (!response.ok) throw new UploadError('We could not read the file you chose. Please pick it again.', 'missing');
  const body = await response.blob();
  if (!body.size) throw new UploadError('That file came through empty. Please pick it again.', 'empty');
  if (body.size > maxBytes) throw tooBig();
  return { body, size: body.size };
}
