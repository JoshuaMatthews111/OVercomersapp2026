// Overcomers Global Network — delete-account
//
// In-app account deletion, start to finish. Apple App Store Review 5.1.1(v)
// and Google Play's User Data policy both require it, and the old "email
// support and wait up to 30 days" row could never satisfy either.
//
// The shape of this file deliberately matches send-push-notification: the
// same esm.sh import, the same corsHeaders, the same OPTIONS/405/500 order,
// the same json() helper and the same `{ error: '...' }` error body.
//
// SECURITY — the two rules this function exists to hold
//   1. The person to delete is read from the caller's own JWT and from
//      nowhere else. A user id in the request body is REFUSED outright, not
//      ignored, so a mistake in a future client cannot quietly become
//      "anyone can delete anyone".
//   2. The service-role key is read from this function's environment and
//      never leaves it. It is not in the app bundle and not in any repo file.
//
// The database work happens inside public.delete_account_cascade (see
// supabase/2026-09-18-account-deletion.sql), which runs as one transaction,
// so a half-finished deletion cannot leave orphans behind.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

type DeleteBody = {
  confirm?: boolean;
};

type StorageTarget = {
  bucket_id?: string | null;
  object_path?: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Buckets this function is allowed to remove bytes from. Nothing else. */
const DELETABLE_BUCKETS = new Set([
  'profile-avatars',
  'story-media',
  'chat-attachments',
  'prayer-attachments',
]);

/** Storage removes in batches; this is the per-request ceiling. */
const REMOVE_CHUNK = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server is not configured.' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // RULE 1. Who is being deleted comes from the token, never from the body.
  const { data: userResult, error: userError } = await authedClient.auth.getUser();
  const user = userResult.user;
  if (userError || !user) return json({ error: 'Authentication required.' }, 401);

  const raw = await req.json().catch(() => ({})) as Record<string, unknown>;
  // Refused, not ignored. If a future client ever starts sending an id, this
  // fails loudly in testing instead of silently opening a door.
  if ('userId' in raw || 'user_id' in raw || 'id' in raw) {
    return json({ error: 'This function deletes the signed-in account only.' }, 400);
  }
  const input = raw as DeleteBody;
  if (input.confirm !== true) {
    return json({ error: 'This request was not confirmed, so nothing was deleted.' }, 400);
  }

  // ── The database, in one transaction ──────────────────────────────────
  const { data: receipt, error: cascadeError } = await serviceClient
    .rpc('delete_account_cascade', { p_user: user.id });

  if (cascadeError) {
    // Never hand a raw database error to a phone. The real one goes to the
    // function log, where the ministry's developer can read it.
    console.error('delete_account_cascade failed', cascadeError);
    const detail = `${cascadeError.message || ''} ${cascadeError.details || ''}`;
    if (detail.includes('last_super_admin')) {
      return json({
        error: 'You are the only owner of this app, so this account cannot be removed yet. Please make somebody else an owner first, then try again.',
      }, 409);
    }
    if (detail.includes('Could not find the function') || detail.includes('does not exist')) {
      return json({
        error: 'Account deletion is not switched on yet. Nothing was removed. Please tell the ministry office.',
      }, 503);
    }
    return json({
      error: 'We could not remove your account just now, so nothing was changed. Please try again in a moment.',
    }, 500);
  }

  const result = (receipt || {}) as { removed?: Record<string, number>; files?: StorageTarget[] };
  const warnings: string[] = [];

  // ── The files ─────────────────────────────────────────────────────────
  // The rows that named these are already gone, so a failure here leaves
  // spare bytes in a bucket, never a broken picture in someone's chat.
  let filesRemoved = 0;
  try {
    const paths = collectPaths(result.files);
    // profile-avatars is the one bucket laid out as <user id>/<file>, so it
    // can be swept directly. chat-attachments is <room>/<user>/<file> and
    // story-media is a shared 'stories/' prefix, so those are found through
    // the database rows above rather than by listing.
    for (const extra of await listOwnedAvatars(serviceClient, user.id)) {
      paths.set(`profile-avatars/${extra}`, { bucket: 'profile-avatars', path: extra });
    }

    const byBucket = new Map<string, string[]>();
    for (const entry of paths.values()) {
      const list = byBucket.get(entry.bucket) || [];
      list.push(entry.path);
      byBucket.set(entry.bucket, list);
    }

    for (const [bucket, list] of byBucket) {
      for (let i = 0; i < list.length; i += REMOVE_CHUNK) {
        const chunk = list.slice(i, i + REMOVE_CHUNK);
        const { data, error } = await serviceClient.storage.from(bucket).remove(chunk);
        if (error) {
          console.error('storage remove failed', bucket, error);
          warnings.push('Some of your files could not be removed and the ministry office has been told.');
        } else {
          filesRemoved += data?.length ?? 0;
        }
      }
    }
  } catch (err) {
    console.error('storage cleanup threw', err);
    warnings.push('Some of your files could not be removed and the ministry office has been told.');
  }

  // ── The sign-in itself, last ──────────────────────────────────────────
  // Everything above has already let go of this row, so nothing can block it.
  const { error: authError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (authError) {
    console.error('auth.admin.deleteUser failed', authError);
    // This is the one genuinely half-finished state, so it is reported as
    // exactly that rather than as a plain failure. The client must not tell
    // anybody they are gone when their sign-in still works.
    return json({
      deleted: false,
      dataRemoved: true,
      removed: result.removed || {},
      filesRemoved,
      error: 'Everything you had saved in the app has been removed, but your sign-in is still there. Please tap Delete my account once more, or tell the ministry office so we can finish it for you.',
    }, 500);
  }

  return json({
    deleted: true,
    dataRemoved: true,
    removed: result.removed || {},
    filesRemoved,
    warnings,
  });
});

/**
 * The paths the database told us about, keyed so the same object cannot be
 * asked for twice, and filtered to the buckets this function may touch.
 */
function collectPaths(files?: StorageTarget[]) {
  const found = new Map<string, { bucket: string; path: string }>();
  for (const file of files || []) {
    const bucket = typeof file?.bucket_id === 'string' ? file.bucket_id : '';
    const path = typeof file?.object_path === 'string' ? file.object_path : '';
    if (!bucket || !path) continue;
    if (!DELETABLE_BUCKETS.has(bucket)) continue;
    found.set(`${bucket}/${path}`, { bucket, path });
  }
  return found;
}

/**
 * Every object under profile-avatars/<user id>/, one folder deep.
 *
 * Storage list() returns a folder as an entry with a null id, so a folder is
 * opened once more and then left alone. Avatars are written flat today
 * (lib/uploadService.ts builds `${userId}/${Date.now()}-${name}`), so the
 * second level is only there so a future layout does not leave files behind.
 */
async function listOwnedAvatars(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<string[]> {
  const out: string[] = [];
  const root = await client.storage.from('profile-avatars').list(userId, { limit: 1000 });
  if (root.error || !root.data) {
    if (root.error) console.error('avatar list failed', root.error);
    return out;
  }
  for (const entry of root.data) {
    if (!entry?.name) continue;
    if (entry.id) {
      out.push(`${userId}/${entry.name}`);
      continue;
    }
    const nested = await client.storage
      .from('profile-avatars')
      .list(`${userId}/${entry.name}`, { limit: 1000 });
    if (nested.error || !nested.data) continue;
    for (const child of nested.data) {
      if (child?.name && child.id) out.push(`${userId}/${entry.name}/${child.name}`);
    }
  }
  return out;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
