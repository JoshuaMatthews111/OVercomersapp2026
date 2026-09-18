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
  canUseEvangelism: boolean;
  canModerateChat: boolean;
  canManageChatMembers: boolean;
  canManageContent: boolean;
  canOverrideLeaderData: boolean;
};

import { hasSupabase } from './publicEnv';

const memberAccess: AccessProfile = {
  rawRoles: ['member'],
  accountStatus: 'active',
  level: 'member',
  canUseEvangelism: false,
  canModerateChat: false,
  canManageChatMembers: false,
  canManageContent: false,
  canOverrideLeaderData: false
};

function normalizeAccess(rawRoles: RawAppRole[], user?: { id?: string; email?: string; displayName?: string }): AccessProfile {
  const roles: RawAppRole[] = rawRoles.length ? rawRoles : ['member'];
  const isSuperAdmin = roles.includes('super_admin') || roles.includes('admin');
  const isLeader = isSuperAdmin || roles.some((role) => role === 'leader' || role === 'staff' || role === 'outreach');
  const canModerateChat = isLeader || roles.includes('moderator');
  const canManageContent = isSuperAdmin || roles.includes('staff') || roles.includes('media_admin');
  return {
    userId: user?.id,
    email: user?.email,
    displayName: user?.displayName,
    accountStatus: 'active',
    rawRoles: roles,
    level: isSuperAdmin ? 'super_admin' : isLeader ? 'leader' : 'member',
    canUseEvangelism: isLeader,
    canModerateChat,
    canManageChatMembers: canModerateChat,
    canManageContent,
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

  if (error || !data) {
    return {
      ...normalizeAccess(['member'], {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name
      }),
      accountStatus,
      accountStatusReason
    };
  }

  return {
    ...normalizeAccess(data.map((row) => row.role as RawAppRole), {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name
    }),
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
