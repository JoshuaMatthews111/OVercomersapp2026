// Follow-up lists for each leader.
//
// The owner's daughter, 2026-09-22: "follow up list groups for each leader,
// where we can check off who we followed up with and a comment on what
// happened." The owner: "Yes."
//
// WHO IS RESPONSIBLE for a person is `assigned_to` on their outreach record, or
// — when nobody has been assigned — whoever wrote the record. The database's
// own rule on follow_up_notes says exactly the same thing, so the list a leader
// sees and the list they are allowed to tick off can never disagree.
//
// HISTORY is kept in public.follow_up_notes, one row per follow-up, and nobody
// can edit a row once it is written (no UPDATE policy, no UPDATE grant). The
// outreach record itself only carries the next date and whether a follow-up is
// still needed. See supabase/2026-09-22-outreach-follow-ups.sql for why that is
// a table and not the status_history jsonb.
//
// The top half of this file is PURE and tested in qa/followup-*.test.mjs. Every
// count it produces is counted from real rows (DO-NOT-BREAK #32).

import { FriendlyError } from './errorMessages';
import { isMissingRelation, type GeoPoint } from './homeCells';
import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';
import { pointFromEwkbHex } from './evangelismService';

export type ContactStatus = 'contact_made' | 'prayed' | 'gospel_shared' | 'invited' | 'bible_study' | 'saved' | 'discipled' | 'not_interested';

export type FollowUpOutcome = 'reached' | 'no_answer' | 'prayed_with' | 'invited' | 'came_to_church' | 'needs_another_call';

/** The six chips, in the order a caller reaches for them. */
export const OUTCOMES: { key: FollowUpOutcome; label: string }[] = [
  { key: 'reached', label: 'Reached them' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'prayed_with', label: 'Prayed with them' },
  { key: 'invited', label: 'Invited to church' },
  { key: 'came_to_church', label: 'Came to church' },
  { key: 'needs_another_call', label: 'Needs another call' },
];

export function outcomeLabel(outcome: string | null | undefined): string {
  return OUTCOMES.find((row) => row.key === outcome)?.label || 'Followed up';
}

export type NextStep = 'none' | 'tomorrow' | 'three_days' | 'next_week' | 'two_weeks';

export const NEXT_STEPS: { key: NextStep; label: string }[] = [
  { key: 'none', label: 'No more follow-up' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'three_days', label: 'In 3 days' },
  { key: 'next_week', label: 'Next week' },
  { key: 'two_weeks', label: 'In 2 weeks' },
];

/**
 * What the "next follow-up" chips start on for each outcome. The leader can
 * change it; this only saves a tap in the common case.
 */
export function defaultNextStep(outcome: FollowUpOutcome): NextStep {
  switch (outcome) {
    case 'no_answer': return 'tomorrow';
    case 'needs_another_call': return 'three_days';
    case 'prayed_with':
    case 'invited': return 'next_week';
    default: return 'none';
  }
}

/** The date a chip means, at 9 in the morning local time. 'none' -> null. */
export function nextFollowUpDate(step: NextStep, now: Date = new Date()): Date | null {
  const days: Record<NextStep, number | null> = { none: null, tomorrow: 1, three_days: 3, next_week: 7, two_weeks: 14 };
  const add = days[step];
  if (add === null || add === undefined) return null;
  const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, 9, 0, 0, 0);
  return when;
}

/** The order a person moves along. `not_interested` sits before all of it. */
const STATUS_LADDER: ContactStatus[] = ['contact_made', 'prayed', 'gospel_shared', 'invited', 'bible_study', 'saved', 'discipled'];

/**
 * The status a follow-up moves a person on to, or null to leave it alone.
 * It only ever moves forward: praying with someone already saved does not
 * mark them back down to "prayed".
 */
export function advanceStatus(current: string | null | undefined, outcome: FollowUpOutcome): ContactStatus | null {
  const target: ContactStatus | null =
    outcome === 'prayed_with' ? 'prayed'
      : outcome === 'invited' || outcome === 'came_to_church' ? 'invited'
        : null;
  if (!target) return null;
  const from = STATUS_LADDER.indexOf(current as ContactStatus);
  const to = STATUS_LADDER.indexOf(target);
  return to > from ? target : null;
}

// ---------------------------------------------------------------------------
// Rows the list is built from (already mapped from the database)
// ---------------------------------------------------------------------------

export type FollowUpContact = {
  id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  territoryId?: string;
  location?: GeoPoint;
  address?: string;
  status: string;
  followUpNeeded: boolean;
  nextFollowUpAt?: string;
  assignedTo?: string;
  assignedName?: string;
  createdBy?: string;
  createdAt?: string;
  prayerRequest?: string;
};

export type FollowUpTask = { id: string; contactId: string; assignedTo?: string; dueAt: string; status: string };

export type FollowUpNote = {
  id: string;
  contactId: string;
  authorId?: string;
  outcome: FollowUpOutcome;
  comment?: string;
  nextFollowUpAt?: string;
  createdAt: string;
};

/** Who looks after this person: the one assigned, else the one who wrote the record. */
export function responsibleId(contact: Pick<FollowUpContact, 'assignedTo' | 'createdBy'>): string | undefined {
  return contact.assignedTo || contact.createdBy || undefined;
}

export type DueBucket = 'overdue' | 'today' | 'no_date' | 'upcoming';

function startOfDay(when: Date): number {
  return new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
}

export function dueBucket(dueAt: string | null | undefined, now: Date = new Date()): DueBucket {
  if (!dueAt) return 'no_date';
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return 'no_date';
  const today = startOfDay(now);
  const tomorrow = today + 24 * 60 * 60 * 1000;
  if (due < today) return 'overdue';
  if (due < tomorrow) return 'today';
  return 'upcoming';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortDate(iso: string): string {
  const when = new Date(iso);
  if (!Number.isFinite(when.getTime())) return '';
  return `${DAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]}`;
}

/** "Overdue since Mon 14 Sep", "Due today", "Due tomorrow", "Due Fri 25 Sep", "No date set". */
export function dueLabel(dueAt: string | null | undefined, now: Date = new Date()): string {
  const bucket = dueBucket(dueAt, now);
  if (bucket === 'no_date' || !dueAt) return 'No date set';
  if (bucket === 'overdue') return `Overdue since ${shortDate(dueAt)}`;
  if (bucket === 'today') return 'Due today';
  const tomorrowStart = startOfDay(now) + 24 * 60 * 60 * 1000;
  if (new Date(dueAt).getTime() < tomorrowStart + 24 * 60 * 60 * 1000) return 'Due tomorrow';
  return `Due ${shortDate(dueAt)}`;
}

export type FollowUpItem = {
  contact: FollowUpContact;
  dueAt?: string;
  bucket: DueBucket;
  lastNote?: FollowUpNote;
  responsibleId?: string;
};

const BUCKET_ORDER: Record<DueBucket, number> = { overdue: 0, today: 1, no_date: 2, upcoming: 3 };

/**
 * Overdue first (longest-waiting at the top), then due today, then the ones
 * nobody gave a date (oldest record first), then upcoming (soonest first).
 */
export function sortFollowUps(items: FollowUpItem[]): FollowUpItem[] {
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0) || 0;
  return [...items].sort((a, b) => {
    const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (byBucket) return byBucket;
    if (a.bucket === 'no_date') return time(a.contact.createdAt) - time(b.contact.createdAt) || a.contact.name.localeCompare(b.contact.name);
    return time(a.dueAt) - time(b.dueAt) || a.contact.name.localeCompare(b.contact.name);
  });
}

/** The newest note for each person. */
export function latestNotes(notes: FollowUpNote[]): Map<string, FollowUpNote> {
  const latest = new Map<string, FollowUpNote>();
  for (const note of notes) {
    const current = latest.get(note.contactId);
    if (!current || new Date(note.createdAt).getTime() > new Date(current.createdAt).getTime()) latest.set(note.contactId, note);
  }
  return latest;
}

function earlier(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

/**
 * Every person still waiting on a follow-up, one item each. An open task on
 * someone whose record says no follow-up is needed still counts — somebody was
 * asked to call them — and its due date wins if it is sooner.
 *
 * Who is responsible is decided by the RECORD alone (responsibleId), never by
 * a task: the database lets exactly that person tick them off, so a task naming
 * somebody else must not put the person on a list they cannot act on.
 * Reassigning moves open tasks along with the record (reassignFollowUp).
 */
export function buildFollowUpItems(
  contacts: FollowUpContact[],
  tasks: FollowUpTask[],
  notes: FollowUpNote[],
  now: Date = new Date()
): FollowUpItem[] {
  const openTasks = new Map<string, FollowUpTask[]>();
  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const list = openTasks.get(task.contactId) || [];
    list.push(task);
    openTasks.set(task.contactId, list);
  }
  const latest = latestNotes(notes);
  const items: FollowUpItem[] = [];
  for (const contact of contacts) {
    const taskList = openTasks.get(contact.id) || [];
    if (!contact.followUpNeeded && !taskList.length) continue;
    const taskDue = taskList.reduce<string | undefined>((soonest, task) => earlier(soonest, task.dueAt), undefined);
    const dueAt = earlier(contact.followUpNeeded ? contact.nextFollowUpAt : undefined, taskDue);
    items.push({
      contact,
      dueAt,
      bucket: dueBucket(dueAt, now),
      lastNote: latest.get(contact.id),
      responsibleId: responsibleId(contact),
    });
  }
  return sortFollowUps(items);
}

/** "My follow-ups": the items this person is responsible for, overdue first. */
export function myFollowUps(items: FollowUpItem[], me: string | null | undefined): FollowUpItem[] {
  if (!me) return [];
  return items.filter((item) => item.responsibleId === me);
}

export type LeaderGroup = {
  leaderId: string | null;
  items: FollowUpItem[];
  open: number;
  overdue: number;
  /** Follow-ups this person recorded in the last `windowDays` days. */
  doneRecently: number;
};

export const TEAM_WINDOW_DAYS = 30;

/**
 * The leaders' Team view: one group per person with work waiting or done
 * lately. Most overdue first, then most waiting, then most done. People with
 * nothing assigned and nothing done are left out, so the list is only people
 * the leader might need to talk to.
 */
export function groupByLeader(items: FollowUpItem[], notes: FollowUpNote[], now: Date = new Date(), windowDays: number = TEAM_WINDOW_DAYS): LeaderGroup[] {
  const since = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const groups = new Map<string, LeaderGroup>();
  const key = (id?: string | null) => id || '';
  const groupFor = (id?: string | null) => {
    const k = key(id);
    let group = groups.get(k);
    if (!group) {
      group = { leaderId: id || null, items: [], open: 0, overdue: 0, doneRecently: 0 };
      groups.set(k, group);
    }
    return group;
  };
  for (const item of items) {
    const group = groupFor(item.responsibleId);
    group.items.push(item);
    group.open += 1;
    if (item.bucket === 'overdue') group.overdue += 1;
  }
  for (const note of notes) {
    if (!note.authorId) continue;
    const when = new Date(note.createdAt).getTime();
    if (!Number.isFinite(when) || when < since || when > now.getTime() + 60_000) continue;
    groupFor(note.authorId).doneRecently += 1;
  }
  return [...groups.values()].sort((a, b) =>
    (b.overdue - a.overdue) || (b.open - a.open) || (b.doneRecently - a.doneRecently)
    || Number(a.leaderId === null) - Number(b.leaderId === null)
  );
}

// ---------------------------------------------------------------------------
// Calling and messaging
// ---------------------------------------------------------------------------

/** Digits (and a leading +) only, for a tel: link. Too short to dial: null. */
export function telLink(number: string | null | undefined): string | null {
  const raw = String(number || '').trim();
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 5 ? `tel:${plus}${digits}` : null;
}

/**
 * A WhatsApp chat link. wa.me wants the full international number: country
 * code, no +, no spaces. A number typed WITHOUT its country code cannot be
 * turned into one safely — "0803 555 0142" with the 0 dropped is a stranger's
 * number in another country — so only these are linked:
 *   * "+234 803 555 0142" or "00234 803 555 0142": used as written;
 *   * ten digits ("(330) 555-0142"): a US number, the ministry's home
 *     congregation, so +1 is added; "1 330 555 0142" is the same number.
 * Anything else gets no WhatsApp button (Call still works), rather than a chat
 * with the wrong person.
 */
export function whatsappLink(number: string | null | undefined): string | null {
  const raw = String(number || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    // Already international.
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 10 && !digits.startsWith('0')) {
    digits = `1${digits}`;
  } else if (!(digits.length === 11 && digits.startsWith('1'))) {
    return null;
  }
  if (digits.startsWith('0')) return null;
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/**
 * A date typed as YYYY-MM-DD (the web form's "Next follow-up date") as the
 * moment the follow-up is due: 9 in the morning LOCAL time, like the chips on
 * the follow-up screen. Sent as a bare "2026-09-29", Postgres stores midnight
 * UTC, which in Ohio is 8 pm the evening before — so the person showed as
 * overdue a day early. Empty: null. Anything unreadable: undefined.
 */
export function followUpDateFromInput(text: string | null | undefined): string | null | undefined {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const when = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (when.getFullYear() !== year || when.getMonth() !== month - 1 || when.getDate() !== day) return undefined;
  return when.toISOString();
}

// ---------------------------------------------------------------------------
// Everything below talks to the network.
// ---------------------------------------------------------------------------

const CONTACT_COLUMNS = 'id, full_name, phone, whatsapp, territory_id, location, address, status, follow_up_needed, next_follow_up_at, assigned_to, assigned_leader_name, created_by, created_at, prayer_request';

function pointFrom(value: any): GeoPoint | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && value.type === 'Point' && Array.isArray(value.coordinates)) {
    const [longitude, latitude] = value.coordinates;
    return typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : undefined;
  }
  if (typeof value === 'string') {
    const wkt = value.match(/POINT\s*\((-?\d+\.?\d*) (-?\d+\.?\d*)\)/i);
    if (wkt) return { longitude: Number(wkt[1]), latitude: Number(wkt[2]) };
    return pointFromEwkbHex(value) || undefined;
  }
  return undefined;
}

export function mapContactRow(row: any): FollowUpContact {
  return {
    id: String(row.id),
    name: row.full_name || 'Household',
    phone: row.phone || undefined,
    whatsapp: row.whatsapp || undefined,
    territoryId: row.territory_id || undefined,
    location: pointFrom(row.location),
    address: row.address || undefined,
    status: row.status || 'contact_made',
    followUpNeeded: row.follow_up_needed === true,
    nextFollowUpAt: row.next_follow_up_at || undefined,
    assignedTo: row.assigned_to || undefined,
    assignedName: row.assigned_leader_name || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at || undefined,
    prayerRequest: row.prayer_request || undefined,
  };
}

export function mapNoteRow(row: any): FollowUpNote {
  return {
    id: String(row.id),
    contactId: String(row.contact_id),
    authorId: row.author_id || undefined,
    outcome: row.outcome,
    comment: row.comment || undefined,
    nextFollowUpAt: row.next_follow_up_at || undefined,
    createdAt: row.created_at,
  };
}

export type FollowUpData = {
  contacts: FollowUpContact[];
  tasks: FollowUpTask[];
  notes: FollowUpNote[];
  /** False when follow_up_notes is not in the database yet. */
  notesReady: boolean;
};

/**
 * Everything the follow-up screen needs, in one go. The records are what the
 * screen is for, so only they can fail the load; tasks and notes each fall
 * back to empty on their own.
 */
export async function getFollowUpData(): Promise<FollowUpData> {
  if (!hasSupabase) return { contacts: [], tasks: [], notes: [], notesReady: false };
  // Notes: the newest 1000 (the server's page size), with no date cut-off. A
  // 120-day window used to hide an older note, and the card then said "No
  // follow-up written yet" about someone who had been called.
  const [contacts, tasks, notes] = await Promise.all([
    supabase.from('outreach_contacts').select(CONTACT_COLUMNS).order('created_at', { ascending: false }).limit(1000),
    supabase.from('follow_up_tasks').select('id, contact_id, assigned_to, due_at, status').eq('status', 'open').limit(1000),
    supabase.from('follow_up_notes').select('id, contact_id, author_id, outcome, comment, next_follow_up_at, created_at').order('created_at', { ascending: false }).limit(1000),
  ]);
  if (contacts.error) throw contacts.error;
  return {
    contacts: (contacts.data || []).map(mapContactRow),
    tasks: tasks.error ? [] : (tasks.data || []).map((row: any) => ({ id: String(row.id), contactId: String(row.contact_id), assignedTo: row.assigned_to || undefined, dueAt: row.due_at, status: row.status })),
    notes: notes.error ? [] : (notes.data || []).map(mapNoteRow),
    notesReady: !notes.error || !isMissingRelation(notes.error),
  };
}

/** Every note ever written about one person, newest first. */
export async function getNotesFor(contactId: string): Promise<FollowUpNote[]> {
  const { data, error } = await supabase
    .from('follow_up_notes')
    .select('id, contact_id, author_id, outcome, comment, next_follow_up_at, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map(mapNoteRow);
}

export type RecordFollowUpInput = {
  contactId: string;
  outcome: FollowUpOutcome;
  comment?: string;
  next: NextStep;
  currentStatus?: string;
};

/**
 * Tick someone off: write the note and move their record on, in one database
 * transaction (public.record_follow_up). Returns the next date, if any.
 */
export async function recordFollowUp(input: RecordFollowUpInput, now: Date = new Date()): Promise<{ nextAt: string | null }> {
  if (!hasSupabase) throw new FriendlyError('This app cannot reach the ministry records right now. Please try again in a moment.');
  const next = nextFollowUpDate(input.next, now);
  const nextAt = next ? next.toISOString() : null;
  const { error } = await supabase.rpc('record_follow_up', {
    p_contact_id: input.contactId,
    p_outcome: input.outcome,
    p_comment: input.comment?.trim() || null,
    p_next_follow_up_at: nextAt,
    p_status: advanceStatus(input.currentStatus, input.outcome),
  });
  if (error) {
    if (isMissingRelation(error)) throw new FriendlyError('Follow-up notes are not switched on for your ministry yet.');
    if (String(error.code) === '42501') throw new FriendlyError('You can only tick off people you look after. Ask a leader to assign this person to you.');
    throw error;
  }
  return { nextAt };
}

/** Leaders and admins: hand a person to someone else on the outreach team. */
export async function reassignFollowUp(contactId: string, person: { id: string; displayName: string }): Promise<void> {
  const { data, error } = await supabase
    .from('outreach_contacts')
    .update({ assigned_to: person.id, assigned_leader_name: person.displayName, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new FriendlyError('Only leaders and admins can hand a follow-up to someone else.');
  // Any open call still sitting with the last person moves with the record.
  await supabase.from('follow_up_tasks').update({ assigned_to: person.id }).eq('contact_id', contactId).eq('status', 'open');
}
