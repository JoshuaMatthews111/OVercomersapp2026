// Photos and short clips on street-evangelism records.
//
// The owner's words, TestFlight 36: "For the street evangelism we should add a
// feature to add a photo or video (for event details)."
//
// How it is kept safe. The bytes go to the PRIVATE `outreach-private` bucket
// under `<region id or no-region>/<uploader id>/<file>` and are read back
// through short-lived signed links — the same shape as chat attachments
// (DO-NOT-BREAK #20). The row that describes the file lives in
// public.outreach_media, which only public.is_outreach_or_above() may read, so
// a member never sees any of it (#2). Nothing here is ever public.
//
// How it stays honest about a 1 GB storage plan. A clip is capped at 60
// seconds, and the bucket and the phone both stop at 20 MB. A minute of video
// from a modern phone is usually bigger than that, so the app says so BEFORE
// the camera opens and, if a clip comes back too big, says exactly how big it
// was and how long it ran instead of a server error.
//
// Nothing in this file writes to the database until the person has saved the
// record they are attaching to. A visit that is still being typed holds its
// uploads as "staged" — the file is already in the bucket, the row is written
// the moment the visit gets an id, and an abandoned upload is taken back out
// of the bucket again (the DELETE policy added by
// supabase/2026-09-23-outreach-media.sql).
import type { ImagePickerAsset } from 'expo-image-picker';

import { FriendlyError, friendlyError } from './errorMessages';
import { isMissingRelation } from './homeCells';
import { supabase } from './supabase';
import { hasSupabase } from './publicEnv';
import { formatBytes, uploadPickedAsset, type UploadProgressHandler } from './uploadService';
import { lookupPeople, type Person } from './evangelismService';

export const OUTREACH_MEDIA_BUCKET = 'outreach-private';
export const OUTREACH_MEDIA_TABLE = 'outreach_media';

/** The owner asked for "a short video". Sixty seconds is the cap the camera is given. */
export const OUTREACH_VIDEO_MAX_SECONDS = 60;

/** What the bucket and lib/uploadBody.ts both refuse above. Kept in step by hand. */
export const OUTREACH_FILE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Said before the camera opens, not after the upload fails.
 *
 * Both halves are true and both matter: the camera stops at a minute, and the
 * ministry's storage plan stops at 20 MB, which a full minute of video usually
 * passes. Saying only the first would be a promise the plan cannot keep.
 */
export const OUTREACH_VIDEO_GUIDANCE =
  `Keep a clip under ${OUTREACH_VIDEO_MAX_SECONDS} seconds. Our storage allows ${formatBytes(OUTREACH_FILE_MAX_BYTES)} a file, so about 20 to 30 seconds is the safe length.`;

export type OutreachSubjectType = 'visit' | 'contact';
export type OutreachMediaKind = 'photo' | 'video';

export type OutreachMediaItem = {
  id: string;
  subjectType: OutreachSubjectType;
  subjectId: string;
  territoryId?: string;
  objectPath: string;
  kind: OutreachMediaKind;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  caption?: string;
  createdBy: string;
  createdAt: string;
  /** Who added it, for the line under the thumbnail. */
  authorName: string;
  /** A signed link, filled in by signOutreachMedia. Absent until then. */
  url?: string;
};

/**
 * Every subject's files, keyed by subjectKey().
 *
 * A plain object rather than a Map on purpose: app/maps.native.tsx imports
 * MapLibre's `Map` component, which shadows the built-in one, and `new Map()`
 * there means something else entirely.
 */
export type OutreachMediaBySubject = Record<string, OutreachMediaItem[]>;

/** Either the files load, or the table is not switched on yet, or it errored. */
export type OutreachMediaResult =
  | { ready: true; bySubject: OutreachMediaBySubject }
  | { ready: false; reason: 'not-switched-on' | 'unavailable' };

// ─────────────────────────────────────────────────────────────────────────────
// Pure parts — no network, no React. Tested in qa/outreach-media.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The key a subject's files are filed under, in one map for both kinds. */
export function subjectKey(type: OutreachSubjectType, id: string): string {
  return `${type}:${id}`;
}

/**
 * The folder a file goes in: `<region id or no-region>/<uploader id>`.
 *
 * The database checks this against the row (the INSERT policy compares folder 1
 * with territory_id and folder 2 with auth.uid()), and the bucket's DELETE
 * policy uses folder 2 to decide who may take a file back. So this shape is not
 * cosmetic — change it here and the two policies have to change with it.
 */
export function outreachPathPrefix(territoryId: string | null | undefined, userId: string): string {
  return `${territoryId || 'no-region'}/${userId}`;
}

const PHOTO_NAME = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|avif)$/i;
const VIDEO_NAME = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;

/**
 * Photo or clip, whatever the label says.
 *
 * The declared type is believed first, because a phone knows what it recorded.
 * The file name only gets a say when the type says nothing useful — the same
 * order the chat's own rules use (DO-NOT-BREAK #50).
 */
export function outreachMediaKind(mimeType?: string | null, fileName?: string | null): OutreachMediaKind | null {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  const named = String(fileName || '').split('?')[0];
  if (VIDEO_NAME.test(named)) return 'video';
  if (PHOTO_NAME.test(named)) return 'photo';
  return null;
}

/** "1:04" from milliseconds, or "" when the phone did not say. */
export function durationLabel(durationMs?: number | null): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return '';
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds - minutes * 60).padStart(2, '0')}`;
}

/**
 * One sentence saying why this file cannot go up, or null when it can.
 *
 * Both answers name the real numbers. "That did not work" after a two-minute
 * upload on a phone at a doorstep is the thing this is written to avoid.
 */
export function refuseOutreachFile(input: {
  kind: OutreachMediaKind | null;
  sizeBytes?: number | null;
  durationMs?: number | null;
  limitBytes?: number;
  maxSeconds?: number;
}): string | null {
  const limit = input.limitBytes ?? OUTREACH_FILE_MAX_BYTES;
  const maxSeconds = input.maxSeconds ?? OUTREACH_VIDEO_MAX_SECONDS;
  if (!input.kind) return 'That kind of file cannot go on an outreach record. Choose a photo or a short video.';
  if (input.kind === 'video' && input.durationMs && input.durationMs > (maxSeconds + 1) * 1000) {
    const ran = durationLabel(input.durationMs);
    return `That clip runs ${ran}. Please keep it under ${maxSeconds} seconds — a shorter one also uploads far faster out in the field.`;
  }
  if (input.sizeBytes && input.sizeBytes > limit) {
    const shorter = input.kind === 'video'
      ? ' Record a shorter clip — about 20 to 30 seconds usually fits.'
      : ' Try another photo.';
    return `That ${input.kind === 'video' ? 'clip' : 'photo'} is ${formatBytes(input.sizeBytes)} and our storage allows ${formatBytes(limit)}.${shorter}`;
  }
  return null;
}

/** "2 photos and 1 video", "1 photo", or "" for nothing. Used on a record's row. */
export function mediaCountLabel(items: { kind: OutreachMediaKind }[]): string {
  const photos = items.filter((item) => item.kind === 'photo').length;
  const videos = items.length - photos;
  const parts: string[] = [];
  if (photos) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  if (videos) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
  if (!parts.length) return '';
  return parts.join(' and ');
}

/** What a screen reader says on a thumbnail. */
export function describeMedia(item: Pick<OutreachMediaItem, 'kind' | 'authorName' | 'durationMs' | 'caption'>): string {
  const what = item.kind === 'video' ? 'Video' : 'Photo';
  const long = item.kind === 'video' && durationLabel(item.durationMs) ? `, ${durationLabel(item.durationMs)} long` : '';
  const caption = item.caption ? `, ${item.caption}` : '';
  return `${what} added by ${item.authorName}${long}${caption}. Open it`;
}

/** One database row as the app holds it. */
export function mapMediaRow(row: any, people?: Map<string, Person>): OutreachMediaItem {
  const kind: OutreachMediaKind = row.media_type === 'video' ? 'video' : 'photo';
  return {
    id: row.id,
    subjectType: row.subject_type === 'contact' ? 'contact' : 'visit',
    subjectId: row.subject_id,
    territoryId: row.territory_id || undefined,
    objectPath: row.object_path,
    kind,
    mimeType: row.mime_type || undefined,
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : undefined,
    width: typeof row.width === 'number' ? row.width : undefined,
    height: typeof row.height === 'number' ? row.height : undefined,
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
    caption: row.caption || undefined,
    createdBy: row.created_by,
    createdAt: row.created_at || new Date().toISOString(),
    authorName: (row.created_by && people?.get(row.created_by)?.displayName) || 'A team member',
  };
}

/** Whether this person may take this file away again. Mirrors the DELETE policy. */
export function canRemoveMedia(item: Pick<OutreachMediaItem, 'createdBy'>, userId: string | null | undefined, isStaff: boolean): boolean {
  return Boolean(isStaff || (userId && item.createdBy === userId));
}

// ─────────────────────────────────────────────────────────────────────────────
// The database and the bucket
// ─────────────────────────────────────────────────────────────────────────────

const MEDIA_COLUMNS =
  'id, subject_type, subject_id, territory_id, object_path, media_type, mime_type, size_bytes, width, height, duration_ms, caption, created_by, created_at';

/**
 * Every file attached to these records, filed by subject.
 *
 * One request per kind of record, then one name lookup, then one signing call —
 * three round trips for a whole screen rather than three per thumbnail.
 * A missing table is "not switched on yet", never a crash: the map and the
 * Reach tab already work that way for visits themselves.
 */
export async function loadOutreachMedia(
  subjects: { type: OutreachSubjectType; id: string }[]
): Promise<OutreachMediaResult> {
  if (!hasSupabase) return { ready: false, reason: 'unavailable' };
  const visitIds = Array.from(new Set(subjects.filter((s) => s.type === 'visit').map((s) => s.id)));
  const contactIds = Array.from(new Set(subjects.filter((s) => s.type === 'contact').map((s) => s.id)));
  if (!visitIds.length && !contactIds.length) return { ready: true, bySubject: {} };

  const requests: Promise<{ data: any[] | null; error: any }>[] = [];
  if (visitIds.length) {
    requests.push(
      supabase.from(OUTREACH_MEDIA_TABLE).select(MEDIA_COLUMNS).eq('subject_type', 'visit').in('subject_id', visitIds).order('created_at').limit(500) as any
    );
  }
  if (contactIds.length) {
    requests.push(
      supabase.from(OUTREACH_MEDIA_TABLE).select(MEDIA_COLUMNS).eq('subject_type', 'contact').in('subject_id', contactIds).order('created_at').limit(500) as any
    );
  }

  const answers = await Promise.all(requests);
  const failure = answers.find((answer) => answer.error);
  if (failure) return { ready: false, reason: isMissingRelation(failure.error) ? 'not-switched-on' : 'unavailable' };

  const rows = answers.flatMap((answer) => answer.data || []);
  const people = await lookupPeople(rows.map((row: any) => row.created_by)).catch(() => new Map<string, Person>());
  const items = rows.map((row: any) => mapMediaRow(row, people));
  await signOutreachMedia(items);

  const bySubject: OutreachMediaBySubject = {};
  for (const item of items) {
    const key = subjectKey(item.subjectType, item.subjectId);
    if (bySubject[key]) bySubject[key].push(item);
    else bySubject[key] = [item];
  }
  return { ready: true, bySubject };
}

/** Four hours: long enough for a morning out, short enough to be worth nothing if it leaks. */
const SIGNED_LINK_SECONDS = 60 * 60 * 4;

/**
 * Fill in a signed link on each item, in ONE call.
 *
 * A file whose link cannot be made keeps `url` undefined and the thumbnail says
 * so, rather than showing a broken picture box.
 */
export async function signOutreachMedia(items: OutreachMediaItem[]): Promise<OutreachMediaItem[]> {
  if (!hasSupabase || !items.length) return items;
  try {
    const { data, error } = await supabase.storage
      .from(OUTREACH_MEDIA_BUCKET)
      .createSignedUrls(items.map((item) => item.objectPath), SIGNED_LINK_SECONDS);
    if (error || !data) return items;
    const byPath = new Map<string, string>();
    for (const entry of data as any[]) {
      // createSignedUrls answers with the path it was given and a signedUrl, or
      // an error for that one file. Anything without a link is simply left out.
      if (entry?.path && entry?.signedUrl) byPath.set(String(entry.path), String(entry.signedUrl));
    }
    for (const item of items) {
      const url = byPath.get(item.objectPath);
      if (url) item.url = url;
    }
  } catch (error) {
    // A link that could not be made is not a reason to lose the record: the
    // thumbnail says "No link" and the record itself still reads correctly.
    // Message only — never the error object, which can echo request headers.
    console.warn('An outreach file could not be given a secure link:', error instanceof Error ? error.message : 'unknown problem');
  }
  return items;
}

/** A file that is already in the bucket but has no row yet. */
export type StagedOutreachFile = {
  objectPath: string;
  /**
   * The region whose folder this file really went into.
   *
   * Kept because the record can move under it: someone picks a photo while
   * Akron is selected, changes to Canton, then saves. The database compares
   * folder 1 of the path with the row's territory_id and refuses the mismatch,
   * and "your account is not on the outreach team" would be the wrong thing to
   * tell them. attachOutreachMedia catches it here and says what happened.
   */
  territoryId: string | null;
  kind: OutreachMediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** The signed link the upload already handed back, for the thumbnail. */
  url?: string;
};

/**
 * Send one picked photo or clip to the private bucket.
 *
 * Nothing is written to the database here. The caller keeps the answer until
 * the record it belongs to has an id — which is what lets someone start a photo
 * uploading and carry on typing their note.
 */
export async function uploadOutreachFile(input: {
  asset: ImagePickerAsset;
  userId: string;
  territoryId?: string | null;
  kind: OutreachMediaKind;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
}): Promise<StagedOutreachFile> {
  const uploaded = await uploadPickedAsset({
    asset: input.asset,
    bucketId: OUTREACH_MEDIA_BUCKET,
    purpose: 'outreach_file',
    pathPrefix: outreachPathPrefix(input.territoryId, input.userId),
    relatedTable: OUTREACH_MEDIA_TABLE,
    onProgress: input.onProgress,
    signal: input.signal,
    // A photo is shrunk to the app's usual long edge before it is sent; a video
    // is sent as the camera made it, because nothing here can re-encode one.
    resize: input.kind === 'photo' ? 'content' : 'none',
  });
  return {
    objectPath: uploaded.objectPath,
    territoryId: input.territoryId || null,
    kind: input.kind,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    width: uploaded.width,
    height: uploaded.height,
    durationMs: typeof input.asset.duration === 'number' && input.asset.duration > 0 ? Math.round(input.asset.duration) : undefined,
    url: uploaded.publicUrl,
  };
}

/**
 * Write the row that puts a staged file on a record.
 *
 * Every refusal the database can give here has a sentence a person can act on.
 * The file itself is already up, so a refusal is also the moment to offer to
 * take it back out of the bucket again.
 */
export async function attachOutreachMedia(input: {
  staged: StagedOutreachFile;
  subjectType: OutreachSubjectType;
  subjectId: string;
  territoryId?: string | null;
  userId: string;
  caption?: string;
  authorName?: string;
}): Promise<OutreachMediaItem> {
  if (!input.userId) throw new FriendlyError('Please sign in again, then add this photo to the record.');
  const territoryId = input.territoryId || null;
  if (input.staged.territoryId !== territoryId) {
    throw new FriendlyError('That photo was filed under a different region, so it was not attached. Open the record and add it again.');
  }
  const { data, error } = await supabase
    .from(OUTREACH_MEDIA_TABLE)
    .insert({
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      territory_id: territoryId,
      object_path: input.staged.objectPath,
      media_type: input.staged.kind,
      mime_type: input.staged.mimeType || null,
      size_bytes: input.staged.sizeBytes || null,
      width: input.staged.width ?? null,
      height: input.staged.height ?? null,
      duration_ms: input.staged.durationMs ?? null,
      caption: input.caption?.trim() ? input.caption.trim().slice(0, 300) : null,
      created_by: input.userId,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) throw error;
  const item = mapMediaRow(data);
  item.authorName = input.authorName || 'You';
  item.url = input.staged.url;
  return item;
}

/**
 * Take a file off a record: the row first, then the file itself.
 *
 * The row goes first on purpose. If the bucket refuses (a file another worker
 * owns, taken off by staff), the record is already clean and the leftover file
 * is a wasted megabyte rather than a picture that keeps showing.
 */
export async function removeOutreachMedia(item: Pick<OutreachMediaItem, 'id' | 'objectPath'>): Promise<RemovalOutcome> {
  const { data, error } = await supabase.from(OUTREACH_MEDIA_TABLE).delete().eq('id', item.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new FriendlyError('Only the person who added this file, or a leader, can take it off.');
  const fileDeleted = await discardOutreachUpload(item.objectPath);
  return { offTheRecord: true, fileDeleted };
}

/**
 * What really happened when a file was taken off.
 *
 * Two separate facts, because they can differ: the row can go while the file
 * itself stays. The screen says the second one out loud rather than reporting
 * a clean removal it cannot vouch for.
 */
export type RemovalOutcome = { offTheRecord: boolean; fileDeleted: boolean };

/**
 * Take an abandoned upload back out of the bucket. True when it really went.
 *
 * Used when a visit is cancelled after a photo has already gone up, and when a
 * row could not be written. On a 1 GB plan an orphan is not free, so this is
 * always attempted — but it never throws, because the thing the person asked
 * for (cancel, or a refusal they can read) has already happened. The answer is
 * returned instead, so a caller who IS in front of a person can say so.
 */
export async function discardOutreachUpload(objectPath: string): Promise<boolean> {
  if (!hasSupabase || !objectPath) return false;
  try {
    const { error } = await supabase.storage.from(OUTREACH_MEDIA_BUCKET).remove([objectPath]);
    if (!error) return true;
    console.warn('An outreach file was left in storage:', error.message);
    return false;
  } catch (error) {
    console.warn('An outreach file was left in storage:', error instanceof Error ? error.message : 'unknown problem');
    return false;
  }
}

/**
 * Whatever a REMOVAL threw, in words about a removal.
 *
 * Separate from friendlyAttachError on purpose: "this file was not attached"
 * under a Remove button is copy that is not true, and a worker reading it would
 * think their photo is still on the record when it may already be gone.
 */
export function friendlyRemoveError(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code || '');
  if (code === '42501') return 'Only the person who added this file, or a leader, can take it off.';
  return friendlyError(error, 'That file could not be taken off the record just now. Please try again in a moment.');
}

/** Whatever an attach threw, in words for a doorstep. */
export function friendlyAttachError(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code || '');
  if (code === '42501') return 'Your account is not on the outreach team, so this file was not attached.';
  if (code === '23503') return 'That record could not be found any more, so the file was not attached.';
  if (code === '23514') return 'That file did not match the record it was filed against, so it was not attached.';
  if (code === '23505') return 'That file is already on this record.';
  return friendlyError(error, 'That file could not be attached just now. Please try again in a moment.');
}
