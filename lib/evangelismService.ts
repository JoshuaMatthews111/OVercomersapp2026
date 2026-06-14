import { contacts, territories } from '../data/mockData';
import { OutreachContact, Territory } from '../types/models';
import { supabase } from './supabase';

const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export async function getTerritories(): Promise<Territory[]> {
  if (!hasSupabase) return territories;
  const { data, error } = await supabase.from('territories').select('*').order('created_at');
  if (error || !data?.length) return territories;
  return data.map((row) => ({
    id: row.id,
    parentId: row.parent_id || undefined,
    name: row.name,
    level: row.level,
    status: row.status,
    center: extractPoint(row.center) || { latitude: 20, longitude: 0 },
    reached: row.reached_count || 0,
    followUps: row.follow_up_count || 0,
    soulsSaved: row.souls_saved_count || 0,
    activeWorkers: row.active_workers_count || 0,
    streetsUntapped: row.streets_untapped_count || 0,
    streetNames: row.street_names || undefined,
    metrics: {
      peopleReached: row.reached_count || 0,
      soulsSaved: row.souls_saved_count || 0,
      prayerRequests: row.prayer_request_count || 0,
      followUpsDue: row.follow_up_count || 0,
      bibleStudiesActive: row.bible_studies_active || 0,
      discipleshipProgress: row.discipleship_progress || 0,
      coveredStreets: row.covered_streets_count || 0,
      inProgressStreets: row.in_progress_streets_count || 0,
      untappedTerritory: row.streets_untapped_count || 0
    }
  }));
}

export async function getOutreachContacts(): Promise<OutreachContact[]> {
  if (!hasSupabase) return contacts;
  const { data, error } = await supabase.from('outreach_contacts').select('*').order('created_at', { ascending: false }).limit(100);
  if (error || !data) return contacts;
  return data.map((row) => ({
    id: row.id,
    territoryId: row.territory_id,
    name: row.full_name || 'Household',
    phone: row.phone || undefined,
    whatsapp: row.whatsapp || undefined,
    email: row.email || undefined,
    address: row.address || undefined,
    location: extractPoint(row.location) || undefined,
    prayerRequest: row.prayer_request || undefined,
    gospelShared: row.gospel_shared,
    invitedToChurch: row.invited_to_church,
    bibleStudyStarted: row.bible_study_started,
    savedAcceptedChrist: row.saved_accepted_christ,
    followUpNeeded: row.follow_up_needed,
    status: row.status,
    assignedTo: row.assigned_leader_name || row.assigned_to || undefined,
    nextFollowUpAt: row.next_follow_up_at || undefined,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    statusHistory: row.status_history || []
  }));
}

export async function saveOutreachContact(input: Partial<OutreachContact> & { territoryId: string; name: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before saving outreach records.');

  const location = input.location ? `POINT(${input.location.longitude} ${input.location.latitude})` : null;
  const { data, error } = await supabase
    .from('outreach_contacts')
    .insert({
      territory_id: input.territoryId,
      created_by: userResult.user.id,
      full_name: input.name,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      address: input.address || null,
      location,
      prayer_request: input.prayerRequest || null,
      gospel_shared: input.gospelShared || false,
      invited_to_church: input.invitedToChurch || false,
      bible_study_started: input.bibleStudyStarted || false,
      saved_accepted_christ: input.savedAcceptedChrist || false,
      follow_up_needed: input.followUpNeeded || false,
      assigned_leader_name: input.assignedTo || null,
      next_follow_up_at: input.nextFollowUpAt || null,
      notes: input.notes || null,
      status: input.status || 'contact_made',
      status_history: [{ status: input.status || 'contact_made', at: new Date().toISOString(), by: userResult.user.id }]
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

function extractPoint(value: any): { latitude: number; longitude: number } | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.latitude === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/POINT\((-?\d+\.?\d*) (-?\d+\.?\d*)\)/);
    if (match) return { longitude: Number(match[1]), latitude: Number(match[2]) };
  }
  return null;
}
