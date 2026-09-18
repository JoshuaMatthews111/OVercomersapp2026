import { prayerRequests, territories } from '../data/mockData';
import { supabase } from './supabase';

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

const fallbackDashboard: AdminDashboard = {
  stories: 5,
  mediaItems: 16,
  newPrayerRequests: prayerRequests.filter((request) => request.status === 'new').length,
  prayerRequests: prayerRequests.length,
  territories: territories.length,
  outreachContacts: 3,
  givingSelections: 0,
  uploadedFiles: 0,
  chatAttachments: 0,
  userRoles: 1,
  unavailable: [],
};

export async function getAdminDashboard(): Promise<AdminDashboard> {
  if (!hasSupabase) return fallbackDashboard;

  const wanted: { key: keyof Omit<AdminDashboard, 'unavailable'>; label: string; table: string; scope?: (query: any) => any }[] = [
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

  const results = await Promise.all(wanted.map((item) => countRows(item.table, item.scope)));

  const dashboard: AdminDashboard = {
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

  wanted.forEach((item, index) => {
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
