import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type RawAppRole =
  | 'visitor'
  | 'member'
  | 'prayer_team'
  | 'media_admin'
  | 'moderator'
  | 'outreach'
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

import { hasSupabase } from './publicEnv';

// ---------------------------------------------------------------------------
// These five sets are copied, role for role, from the security functions the
// database actually runs (supabase/rls_policies.sql). If the client grants a
// power the database refuses, the person gets the full admin screen and then a
// silent refusal — which is exactly what happened to media_admin before.
// Change a set here ONLY when the matching SQL function changes.
// ---------------------------------------------------------------------------

/** public.is_super_admin() */
const SUPER_ADMIN_ROLES: RawAppRole[] = ['admin', 'super_admin'];
/** public.is_staff_or_above() */
const STAFF_OR_ABOVE_ROLES: RawAppRole[] = ['staff', 'leader', 'admin', 'super_admin'];
/** public.is_outreach_or_above() */
const OUTREACH_OR_ABOVE_ROLES: RawAppRole[] = ['outreach', 'staff', 'leader', 'admin', 'super_admin'];
/** public.is_chat_moderator() */
const CHAT_MODERATOR_ROLES: RawAppRole[] = ['moderator', 'staff', 'leader', 'admin', 'super_admin'];
/** public.is_media_manager() */
const MEDIA_MANAGER_ROLES: RawAppRole[] = ['media_admin', 'staff', 'admin', 'super_admin'];
/** public.is_prayer_manager() */
const PRAYER_MANAGER_ROLES: RawAppRole[] = ['prayer_team', 'staff', 'leader', 'admin', 'super_admin'];

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
  // the ministry side: leader, staff, outreach, admin, super_admin.
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

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userResult.user;
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

  return {
    ...normalizeAccess(data.map((row) => row.role as RawAppRole), identity),
    accountStatus,
    accountStatusReason
  };
}

export function useAccessProfile() {
  const [access, setAccess] = useState<AccessProfile>(memberAccess);
  const [loadingAccess, setLoadingAccess] = useState(true);

  useEffect(() => {
    let mounted = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    function refreshAccess(currentRevision: number) {
      getAccessProfile().then((nextAccess) => {
        if (mounted && revision === currentRevision) setAccess(nextAccess);
      }).catch(() => {
        if (mounted && revision === currentRevision) setAccess(memberAccess);
      }).finally(() => {
        if (mounted && revision === currentRevision) setLoadingAccess(false);
      });
    }
    refreshAccess(revision);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      clearTimeout(refreshTimer);
      const currentRevision = ++revision;
      if (!session) { setAccess(memberAccess); setLoadingAccess(false); return; }
      // Auth callbacks must return before starting another auth request.
      refreshTimer = setTimeout(() => refreshAccess(currentRevision), 0);
    });

    return () => {
      mounted = false;
      clearTimeout(refreshTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  return { access, loadingAccess };
}
