import { prayerRequests, territories } from '../data/mockData';
import { supabase } from './supabase';

const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

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
};

export async function getAdminDashboard(): Promise<AdminDashboard> {
  if (!hasSupabase) return fallbackDashboard;

  const [
    stories,
    mediaItems,
    newPrayerRequests,
    allPrayerRequests,
    territoryCount,
    outreachContacts,
    givingSelections,
    uploadedFiles,
    chatAttachments,
    userRoles,
  ] = await Promise.all([
    countRows('app_stories'),
    countRows('media_items'),
    countRows('prayer_requests', (query) => query.eq('status', 'new')),
    countRows('prayer_requests'),
    countRows('territories'),
    countRows('outreach_contacts'),
    countRows('giving_selections'),
    countRows('uploaded_files'),
    countRows('chat_attachments'),
    countRows('user_roles'),
  ]);

  return {
    stories,
    mediaItems,
    newPrayerRequests,
    prayerRequests: allPrayerRequests,
    territories: territoryCount,
    outreachContacts,
    givingSelections,
    uploadedFiles,
    chatAttachments,
    userRoles,
  };
}

async function countRows(table: string, scope?: (query: any) => any): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (scope) query = scope(query);
  const { count, error } = await query;
  if (error) return 0;
  return count || 0;
}
