import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { hasSupabase } from './publicEnv';

export type RawAppRole =
  | 'visitor'
  | 'member'
  | 'prayer_team'
  | 'media_admin'
  | 'moderator'
  | 'outreach'
  | 'outreach_worker'
  | 'staff'
  | 'leader'
  | 'admin'
  | 'super_admin';
export type AccessLevel = 'member' | 'leader' | 'super_admin';

export type AccessProfile = {
  userId?: string;
  email?: string;
  displayName?: string;
  accountStatus?: 'active' | 'paused' | 'muted' | 'removed';
  accountStatusReason?: string;
  rawRoles: RawAppRole[];
  level: AccessLevel;
  /** True once we know who this is. A signed-out person is false. */
  isSignedIn: boolean;
  canUseEvangelism: boolean;
  /** Sees held/flagged chat messages. Mirrors is_chat_moderator(). */
  canModerateChat: boolean;
  /**
   * Removes someone else's chat message for everyone. The database gates that
   * UPDATE on is_staff_or_above(), NOT on is_chat_moderator() — so a plain
   * `moderator` can see a held message but cannot remove it.
   */
  canRemoveChatMessages: boolean;
  /** Adds or removes people from a room. Mirrors is_staff_or_above(). */
  canManageChatMembers: boolean;
  /** Stories, events and the rest of the app content. Mirrors is_staff_or_above(). */
  canManageContent: boolean;
  /** Sermons, videos, music. Mirrors is_media_manager(). */
  canManageMedia: boolean;
  /** Prayer requests and their workflow. Mirrors is_prayer_manager(). */
  canManagePrayer: boolean;
  /** Who may open the Admin screen at all. Unchanged from before this release. */
  canOpenAdmin: boolean;
  canOverrideLeaderData: boolean;
};

// ---------------------------------------------------------------------------
// These six sets are copied, role for role, from the security functions the
// database actually runs. If the client grants a power the database refuses,
// the person gets the full admin screen and then a silent refusal — which is
// exactly what happened to media_admin before. If the client WITHHOLDS a power
// the database grants, the person is shown six tabs where the database would
// have served them seven, and nothing they tap explains why.
//
// Read from the live project (ljmzujrzdhwmvvapajlr) on 2026-09-19 with
// pg_get_functiondef, not from supabase/rls_policies.sql: that file had drifted
// behind production on is_outreach_or_above(). Change a set here ONLY when the
// matching SQL function changes, and re-read the live function to be sure.
// ---------------------------------------------------------------------------

/** public.is_super_admin() — ('admin','super_admin') */
const SUPER_ADMIN_ROLES: RawAppRole[] = ['admin', 'super_admin'];
/** public.is_staff_or_above() — ('staff','leader','admin','super_admin') */
const STAFF_OR_ABOVE_ROLES: RawAppRole[] = ['staff', 'leader', 'admin', 'super_admin'];
/**
 * public.is_outreach_or_above() —
 * ('outreach','outreach_worker','staff','leader','admin','super_admin').
 *
 * `outreach_worker` was missing here. The enum has held it since the role was
 * added, and the live function grants it, so a street-team member given that
 * role signed in, saw six tabs and no Reach tab, while the database was ready
 * to hand them territories and visits. DO-NOT-BREAK item 1 requires this set
 * to mirror is_outreach_or_above() exactly; now it does.
 */
const OUTREACH_OR_ABOVE_ROLES: RawAppRole[] = [
  'outreach',
  'outreach_worker',
  'staff',
  'leader',
  'admin',
  'super_admin'
];
/** public.is_chat_moderator() — ('moderator','staff','leader','admin','super_admin') */
const CHAT_MODERATOR_ROLES: RawAppRole[] = ['moderator', 'staff', 'leader', 'admin', 'super_admin'];
/** public.is_media_manager() — ('media_admin','staff','admin','super_admin') */
const MEDIA_MANAGER_ROLES: RawAppRole[] = ['media_admin', 'staff', 'admin', 'super_admin'];
/** public.is_prayer_manager() — ('prayer_team','staff','leader','admin','super_admin') */
const PRAYER_MANAGER_ROLES: RawAppRole[] = ['prayer_team', 'staff', 'leader', 'admin', 'super_admin'];

/**
 * Every value in the database's own `app_role` enum, in its enum order. A row
 * that carries anything else is a role this build has never heard of, so it is
 * dropped rather than cast through — the old `row.role as RawAppRole` let an
 * unknown value into a typed array where nothing would ever match it and
 * nothing would ever say so.
 */
const KNOWN_ROLES: RawAppRole[] = [
  'visitor',
  'member',
  'outreach',
  'staff',
  'leader',
  'admin',
  'super_admin',
  'prayer_team',
  'media_admin',
  'moderator',
  'outreach_worker'
];

function toRawRole(value: unknown): RawAppRole | null {
  return typeof value === 'string' && (KNOWN_ROLES as string[]).includes(value)
    ? (value as RawAppRole)
    : null;
}

function hasAny(roles: RawAppRole[], allowed: RawAppRole[]) {
  return roles.some((role) => allowed.includes(role));
}

const memberAccess: AccessProfile = {
  rawRoles: ['member'],
  accountStatus: 'active',
  level: 'member',
  isSignedIn: false,
  canUseEvangelism: false,
  canModerateChat: false,
  canRemoveChatMessages: false,
  canManageChatMembers: false,
  canManageContent: false,
  canManageMedia: false,
  canManagePrayer: false,
  canOpenAdmin: false,
  canOverrideLeaderData: false
};

function normalizeAccess(rawRoles: RawAppRole[], user?: { id?: string; email?: string; displayName?: string }): AccessProfile {
  const roles: RawAppRole[] = rawRoles.length ? rawRoles : ['member'];
  const isSuperAdmin = hasAny(roles, SUPER_ADMIN_ROLES);
  const canUseEvangelism = hasAny(roles, OUTREACH_OR_ABOVE_ROLES);
  const canModerateChat = hasAny(roles, CHAT_MODERATOR_ROLES);
  const canManageContent = hasAny(roles, STAFF_OR_ABOVE_ROLES);
  const canManageMedia = hasAny(roles, MEDIA_MANAGER_ROLES);
  const canManagePrayer = hasAny(roles, PRAYER_MANAGER_ROLES);
  // "leader" in the app's own language means anyone above a plain member on
  // the ministry side: leader, staff, outreach, outreach_worker, admin,
  // super_admin.
  const isLeader = canManageContent || canUseEvangelism;
  return {
    userId: user?.id,
    email: user?.email,
    displayName: user?.displayName,
    accountStatus: 'active',
    rawRoles: roles,
    level: isSuperAdmin ? 'super_admin' : isLeader ? 'leader' : 'member',
    isSignedIn: Boolean(user?.id),
    canUseEvangelism,
    canModerateChat,
    canRemoveChatMessages: canManageContent,
    canManageChatMembers: canManageContent,
    canManageContent,
    canManageMedia,
    canManagePrayer,
    // Exactly the same people who could open Admin before this release:
    // staff, leader, admin, super_admin, outreach, moderator, media_admin.
    // DO-NOT-BREAK item 2 keeps Admin role-gated; this does not widen it.
    canOpenAdmin: canManageContent || canManageMedia || canModerateChat || canUseEvangelism,
    canOverrideLeaderData: isSuperAdmin
  };
}

export async function getAccessProfile(): Promise<AccessProfile> {
  if (!hasSupabase) return memberAccess;

  /**
   * Read who this is from the session already on the device.
   *
   * This used to be supabase.auth.getUser(), which is a real network round
   * trip: @supabase/auth-js 2.108.1 GoTrueClient._getUser() ends in
   * `_request(this.fetch, 'GET', `${this.url}/user`, ...)` after it has read
   * the same local session anyway. It ran on every launch, once per mounted
   * screen. getSession() reads what is on the phone and only goes to the
   * network when the token has actually expired. Row-level security is what
   * decides which rows come back, so trusting the local id weakens nothing —
   * the same reasoning is already written down in lib/uploadService.ts:82-88.
   */
  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionResult.session?.user;
  if (!user) return memberAccess;

  const [{ data, error }, { data: statusRow, error: statusError }] = await Promise.all([
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id),
    supabase
      .from('user_admin_status')
      .select('status, reason')
      .eq('user_id', user.id)
      .maybeSingle()
  ]);
  if (statusError) throw statusError;

  const accountStatus = (statusRow?.status || 'active') as AccessProfile['accountStatus'];
  const accountStatusReason = statusRow?.reason || undefined;

  const identity = {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name
  };

  if (error || !data) {
    return {
      ...normalizeAccess(['member'], identity),
      accountStatus,
      accountStatusReason
    };
  }

  const roles = data
    .map((row) => toRawRole(row.role))
    .filter((role): role is RawAppRole => role !== null);

  return {
    ...normalizeAccess(roles, identity),
    accountStatus,
    accountStatusReason
  };
}

// ---------------------------------------------------------------------------
// One answer for the whole app.
//
// useAccessProfile() is called on ten screens (the tab layout, Home, Media,
// Chat, More, Reach, Admin, a chat room and both map screens). It used to do
// two things per mount, both wrong:
//
//   1. It started its own read AND registered its own auth listener, and
//      @supabase/auth-js hands every brand-new subscriber an INITIAL_SESSION
//      the instant it subscribes (GoTrueClient._emitInitialSession). That
//      second read bumped the revision counter, so the first read's result was
//      thrown away when it landed — the whole profile fetched twice per mount
//      and half of it discarded.
//   2. Because each mount had its own listener, a single INITIAL_SESSION that
//      arrived carrying null — which _emitInitialSession also does when the
//      session read merely ERRORS — reset that screen to a signed-out member.
//      An admin standing on the Admin screen watched it turn into "Admins
//      only".
//
// So now there is exactly one listener, one read in flight at a time, and one
// cached answer that every screen reads. The rules it follows are the same
// ones app/_layout.tsx follows for the session itself, on purpose:
//
//   - Only SIGNED_OUT (and USER_DELETED) means the person is gone. Nothing
//     else may reset the answer to "member".
//   - A null session carried by TOKEN_REFRESHED, SIGNED_IN or USER_UPDATED is
//     a token mid-flight, not a departure. Keep what we know.
//   - A different user id means everything cached is about somebody else:
//     forget it, fail closed, and read again.
//
// That last rule is what keeps the cache honest when the signed-in person
// changes. The cache is also wiped outright on sign-out, so the next person to
// sign in on this phone starts from "we do not know", which reads as a member.
// ---------------------------------------------------------------------------

type AccessState = { access: AccessProfile; loadingAccess: boolean };

const SIGNED_OUT_EVENTS = new Set<string>(['SIGNED_OUT', 'USER_DELETED']);

let state: AccessState = { access: memberAccess, loadingAccess: true };
const listeners = new Set<() => void>();

/**
 * How long a settled answer is served without asking again.
 *
 * A screen opening later in the session gets the cached answer instantly, but
 * a role the ministry took away this morning must not outlive the morning. So
 * once an answer is this old, the next screen to open reads it again quietly
 * behind the cached one — no spinner, and nothing moves on screen unless the
 * answer actually changed.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Who the cached answer is about. null means "nobody, or we do not know". */
let knownUserId: string | null = null;
/** When the cached answer was last proved. 0 means "never, or forgotten". */
let settledAt = 0;
/** Bumped whenever the cached answer stops being trustworthy. */
let revision = 0;
let inFlight: { revision: number; promise: Promise<void> } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function sameAnswer(a: AccessProfile, b: AccessProfile) {
  return a.userId === b.userId
    && a.isSignedIn === b.isSignedIn
    && a.level === b.level
    && a.accountStatus === b.accountStatus
    && a.accountStatusReason === b.accountStatusReason
    && a.canUseEvangelism === b.canUseEvangelism
    && a.canModerateChat === b.canModerateChat
    && a.canRemoveChatMessages === b.canRemoveChatMessages
    && a.canManageChatMembers === b.canManageChatMembers
    && a.canManageContent === b.canManageContent
    && a.canManageMedia === b.canManageMedia
    && a.canManagePrayer === b.canManagePrayer
    && a.canOpenAdmin === b.canOpenAdmin
    && a.canOverrideLeaderData === b.canOverrideLeaderData
    && a.displayName === b.displayName
    && a.email === b.email
    && a.rawRoles.join(',') === b.rawRoles.join(',');
}

function publish(next: AccessState) {
  // A token refresh an hour into the session re-reads the same roles and gets
  // the same answer. Re-rendering ten screens over that is noise, so only a
  // real change is announced.
  if (next.loadingAccess === state.loadingAccess && sameAnswer(next.access, state.access)) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** The cached answer is about to stop being true. Stop any read still coming. */
function forget() {
  revision += 1;
  inFlight = null;
  knownUserId = null;
  settledAt = 0;
}

function settle(next: AccessProfile | null) {
  const access = next || memberAccess;
  knownUserId = access.isSignedIn ? access.userId || null : null;
  settledAt = Date.now();
  publish({ access, loadingAccess: false });
}

function refresh(): Promise<void> {
  // Ten screens mounting together share one read.
  if (inFlight && inFlight.revision === revision) return inFlight.promise;
  const mine = revision;
  const promise = getAccessProfile()
    .then((next) => { if (mine === revision) settle(next); })
    .catch(() => {
      // The roles could not be read. Fail closed — treat this person as a
      // member until a later read succeeds — so nothing is offered that the
      // database would then refuse. Nobody is left staring at a blank screen
      // over it either: the screens that can say something already do, from
      // their own reads (app/(tabs)/_layout.tsx:173-197 offers Try Again).
      if (mine === revision) settle(null);
    })
    .finally(() => {
      if (inFlight && inFlight.revision === mine) inFlight = null;
    });
  inFlight = { revision: mine, promise };
  return promise;
}

function scheduleRefresh() {
  // An auth callback must return before another auth request starts, and a
  // burst of events should cost one read, not one each.
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void refresh(); }, 0);
}

function onAuthEvent(event: string, session: Session | null) {
  if (SIGNED_OUT_EVENTS.has(event)) {
    clearTimeout(refreshTimer);
    forget();
    publish({ access: memberAccess, loadingAccess: false });
    return;
  }

  const nextUserId = session?.user?.id || null;

  // Only INITIAL_SESSION is allowed to arrive empty and be believed, and even
  // then we confirm it against the stored session rather than acting on the
  // event alone — auth-js emits INITIAL_SESSION with null when the session
  // read merely errors, and a flaky moment at launch must not demote a leader.
  if (!nextUserId && event !== 'INITIAL_SESSION') return;

  if (nextUserId !== knownUserId) {
    forget();
    // Fail closed while we find out. DO-NOT-BREAK item 1: until there is a
    // settled answer the Reach tab is hidden.
    publish({ access: memberAccess, loadingAccess: true });
  }
  scheduleRefresh();
}

function start() {
  if (started) return;
  started = true;
  // No eager read here on purpose. auth-js delivers INITIAL_SESSION to this
  // subscriber the moment it subscribes, and that is the first read.
  supabase.auth.onAuthStateChange(onAuthEvent);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  // Opening a screen shows the answer we already proved, with no wait. If that
  // answer has been sitting a while, ask again behind it — so a role granted
  // or taken away arrives by opening a tab, not only by restarting the app.
  if (settledAt && Date.now() - settledAt > STALE_AFTER_MS) scheduleRefresh();
  return () => { listeners.delete(listener); };
}

function getSnapshot(): AccessState {
  return state;
}

/**
 * What this person is allowed to do, and whether we know yet.
 *
 * The shape is unchanged — `{ access, loadingAccess }` — so every screen that
 * already reads it keeps working. What changed is underneath: the answer is
 * shared, so the second screen to ask pays nothing and paints immediately.
 */
export function useAccessProfile() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
