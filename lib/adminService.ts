// Counts and small work lists for the Admin screen.
//
// Nothing in this file is ever invented. It used to open with sample prayer
// requests and sample regions and hand them out as a "dashboard" whenever the
// app could not reach the database, so an admin could be looking at five
// stories and sixteen library items that did not exist. A count we could not
// read is now reported as unknown, by name, and the screen draws a dash.
import { supabase } from './supabase';
import { youtubeThumbnailUrl } from './embed';
import { FriendlyError } from './errorMessages';
import { MediaKind } from '../types/models';

import { hasSupabase } from './publicEnv';

export type AdminDashboard = {
  stories: number;
  mediaItems: number;
  newPrayerRequests: number;
  prayerRequests: number;
  territories: number;
  outreachContacts: number;
  givingSelections: number;
  uploadedFiles: number;
  chatAttachments: number;
  userRoles: number;
  /**
   * Names of the counts we could not read. A count listed here is showing 0
   * because we do not know, not because there is nothing there — draw a dash
   * rather than a confident zero.
   */
  unavailable: string[];
};

const COUNTS: { key: keyof Omit<AdminDashboard, 'unavailable'>; label: string; table: string; scope?: (query: any) => any }[] = [
  { key: 'stories', label: 'stories', table: 'app_stories' },
  { key: 'mediaItems', label: 'the library', table: 'media_items' },
  { key: 'newPrayerRequests', label: 'new prayer requests', table: 'prayer_requests', scope: (query) => query.eq('status', 'new') },
  { key: 'prayerRequests', label: 'prayer requests', table: 'prayer_requests' },
  { key: 'territories', label: 'regions', table: 'territories' },
  { key: 'outreachContacts', label: 'outreach records', table: 'outreach_contacts' },
  { key: 'givingSelections', label: 'giving', table: 'giving_selections' },
  { key: 'uploadedFiles', label: 'uploaded files', table: 'uploaded_files' },
  { key: 'chatAttachments', label: 'chat attachments', table: 'chat_attachments' },
  { key: 'userRoles', label: 'the people list', table: 'user_roles' },
];

function emptyDashboard(): AdminDashboard {
  return {
    stories: 0,
    mediaItems: 0,
    newPrayerRequests: 0,
    prayerRequests: 0,
    territories: 0,
    outreachContacts: 0,
    givingSelections: 0,
    uploadedFiles: 0,
    chatAttachments: 0,
    userRoles: 0,
    unavailable: [],
  };
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  // No database settings means every one of these numbers is unknown. Saying
  // so is the honest answer; a set of confident made-up figures is not.
  if (!hasSupabase) {
    return { ...emptyDashboard(), unavailable: COUNTS.map((item) => item.label) };
  }

  const results = await Promise.all(COUNTS.map((item) => countRows(item.table, item.scope)));
  const dashboard = emptyDashboard();

  COUNTS.forEach((item, index) => {
    const count = results[index];
    if (count === null) {
      if (!dashboard.unavailable.includes(item.label)) dashboard.unavailable.push(item.label);
      return;
    }
    dashboard[item.key] = count;
  });

  return dashboard;
}

/** null means "we could not find out", which is not the same as zero. */
async function countRows(table: string, scope?: (query: any) => any): Promise<number | null> {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (scope) query = scope(query);
    const { count, error } = await query;
    if (error) return null;
    return count || 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Covers still needed
//
// V4 and A5: the owner should be able to see, in one place, everything that is
// live without a cover picture, and clear the backlog quickly. A YouTube link
// already carries its own picture, so anything we can work a cover out from is
// NOT in this list — only the rows a person really has to choose a picture for.
// ---------------------------------------------------------------------------

/** One published thing that is live with no cover picture. */
export type CoverNeeded = {
  /** Which table it lives in. It decides where a new cover is saved. */
  source: 'media' | 'sermon';
  id: string;
  title: string;
  speaker?: string;
  /** 'sermon', 'video', 'music'... for a media row; always 'sermon' for a sermon. */
  kind: MediaKind;
  publishedAt?: string;
};

export type CoversNeeded = {
  items: CoverNeeded[];
  /**
   * Plain-English names of the lists we could not read, e.g. ["sermons"].
   * A name here means UNKNOWN, so the screen must not say the backlog is clear.
   */
  unavailable: string[];
};

/**
 * Everything published with no cover, newest first.
 *
 * Both queries ask the database for the rows with no cover rather than reading
 * the whole table and sifting it here — media_items_missing_thumbnail_idx (see
 * supabase/2026-09-18-release-hardening.sql) exists for exactly this query, so
 * it stays quick as the library grows.
 */
export async function getCoversNeeded(limit = 40): Promise<CoversNeeded> {
  if (!hasSupabase) return { items: [], unavailable: ['the library', 'sermons'] };

  const [mediaResult, sermonResult] = await Promise.allSettled([
    supabase
      .from('media_items')
      .select('id, title, media_type, speaker, external_url, published_at')
      .is('thumbnail_url', null)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit),
    supabase
      .from('sermons')
      .select('id, title, speaker, video_url, published_at')
      .is('thumbnail_url', null)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit),
  ]);

  const unavailable: string[] = [];
  const items: CoverNeeded[] = [];

  if (mediaResult.status === 'fulfilled' && !mediaResult.value.error) {
    for (const row of mediaResult.value.data || []) {
      // A YouTube link already has a picture of its own, so it is not waiting
      // on anybody.
      if (row.external_url && youtubeThumbnailUrl(row.external_url)) continue;
      items.push({
        source: 'media',
        id: row.id,
        title: (row.title || '').trim() || 'Untitled',
        speaker: row.speaker || undefined,
        kind: (row.media_type as MediaKind) || 'video',
        publishedAt: row.published_at || undefined,
      });
    }
  } else {
    unavailable.push('the library');
  }

  if (sermonResult.status === 'fulfilled' && !sermonResult.value.error) {
    for (const row of sermonResult.value.data || []) {
      if (row.video_url && youtubeThumbnailUrl(row.video_url)) continue;
      items.push({
        source: 'sermon',
        id: row.id,
        title: (row.title || '').trim() || 'Untitled message',
        speaker: row.speaker || undefined,
        kind: 'sermon',
        publishedAt: row.published_at || undefined,
      });
    }
  } else {
    unavailable.push('sermons');
  }

  items.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  return { items, unavailable };
}

/**
 * Save a cover picture on a sermon row.
 *
 * Proves the change landed: the database is asked to hand the row back, and an
 * empty answer means nothing was written — which is a permission problem, not
 * a success. (supabase/rls_policies.sql:78 lets only a super admin edit
 * sermons, so a staff member will see the message below rather than a silent
 * no-op.) media_items covers go through updateMediaRecord in
 * lib/adminManagementService.ts, which keeps the same promise.
 */
export async function setSermonCover(id: string, thumbnailUrl: string): Promise<{ id: string }> {
  if (!hasSupabase) {
    throw new FriendlyError('We could not reach Overcomers Global Network just now. Please check your connection and try again.');
  }
  const { data, error } = await supabase
    .from('sermons')
    .update({ thumbnail_url: thumbnailUrl || null })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That cover was not saved. Your account does not have permission to edit sermons — ask an OGN admin.');
  }
  return { id };
}
