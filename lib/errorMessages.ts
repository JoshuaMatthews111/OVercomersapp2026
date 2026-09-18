// Every message a person sees when something goes wrong comes from here.
//
// Two rules, and they are not negotiable:
//   1. A raw Postgres, PostgREST, storage or fetch string NEVER reaches a
//      person. Those strings are for us, in a log, not for someone trying to
//      share a testimony.
//   2. Every message says what happened in plain words and what to do next.
//
// If you need to show wording you have already written by hand, throw a
// FriendlyError. friendlyError() passes it through untouched.

/**
 * An error whose message is already written for a person to read.
 * Throw this from the data layer when you know exactly what to say.
 */
export class FriendlyError extends Error {
  readonly isFriendly = true;
  constructor(message: string) {
    super(message);
    this.name = 'FriendlyError';
  }
}

/**
 * The real upload ceilings on the live Supabase buckets, in megabytes.
 * Checked against the project on 2026-09-18. Keep this table honest: the
 * whole point is that a person is told the true limit, not a guess.
 */
export const STORAGE_LIMIT_MB: Record<string, number> = {
  'app-assets': 1024,
  'story-media': 1024,
  'sermon-media': 500,
  'chat-attachments': 50,
  'ogn-public': 10,
  'profile-avatars': 5,
  'outreach-private': 20,
  'prayer-attachments': 20,
};

/** Friendly names for the buckets, so nobody reads "ogn-public" on a phone. */
const BUCKET_LABEL: Record<string, string> = {
  'app-assets': 'this upload',
  'story-media': 'a story',
  'sermon-media': 'a sermon',
  'chat-attachments': 'a chat message',
  'ogn-public': 'this upload',
  'profile-avatars': 'a profile photo',
  'outreach-private': 'an outreach record',
  'prayer-attachments': 'a prayer request',
};

function megabytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * "That video is 82 MB. A chat message can carry up to 50 MB — please trim it
 *  or send a shorter clip."
 */
export function tooLargeMessage(bucketId: string, actualBytes?: number): string {
  const limit = STORAGE_LIMIT_MB[bucketId];
  const what = BUCKET_LABEL[bucketId] || 'this upload';
  const size = typeof actualBytes === 'number' && actualBytes > 0 ? `That file is ${megabytes(actualBytes)}, which is ` : 'That file is ';
  if (!limit) return `${size}too big to send. Please choose a smaller one.`;
  const cap = limit >= 1024 ? `${Math.round(limit / 1024)} GB` : `${limit} MB`;
  return `${size}bigger than the ${cap} we can take for ${what}. Please choose a smaller file or a shorter clip.`;
}

// The wording we reuse, in one place so it stays consistent everywhere.
export const MESSAGES = {
  permission: 'Your account does not have permission for this yet. Ask an OGN admin to give you access.',
  signIn: 'Please sign in again, then try once more.',
  slow: 'That is taking longer than it should. Check your connection and try again.',
  unreachable: 'We could not reach the OGN server. Check your connection and try again in a moment.',
  offline: 'You appear to be offline. Reconnect and try again.',
  tooLarge: 'That file is too big to send. Please choose a smaller one.',
  duplicate: 'That is already saved.',
  missingField: 'Something required was left out. Please fill the form in and try again.',
  storage: 'We could not save that file right now. Please try again in a moment.',
  notFound: 'We could not find that. It may have been removed.',
  generic: 'Something went wrong. Please try again.',
} as const;

/**
 * The HTTP status, when there is one. Kept apart from the Postgres SQLSTATE on
 * purpose: "23502" (a not-null violation) contains the characters "502", and
 * matching those loosely once turned a missing form field into "the server is
 * down". Statuses are compared as numbers, never as substrings.
 */
function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  for (const candidate of [record.status, record.statusCode, record.httpStatus]) {
    const value = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

/** The Postgres SQLSTATE or PostgREST code, lowercased. Never a HTTP status. */
function readPgCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  return `${code} ${name}`.trim().toLowerCase();
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message || '';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error_description === 'string') return record.error_description;
    if (typeof record.error === 'string') return record.error;
  }
  return '';
}

/**
 * Turn anything that was thrown into one warm, useful sentence.
 *
 * `fallback` is what to say when we genuinely cannot tell what happened —
 * write it for the screen it is shown on ("We could not post your story just
 * yet. Please try again."), never "Error".
 */
export function friendlyError(error: unknown, fallback: string = MESSAGES.generic): string {
  // Wording we already wrote by hand wins over every guess below.
  if (error instanceof FriendlyError) return error.message;
  if (error && typeof error === 'object' && (error as { isFriendly?: boolean }).isFriendly) {
    const own = readMessage(error);
    if (own) return own;
  }

  const message = readMessage(error);
  const code = readPgCode(error);
  const status = readStatus(error);
  const lower = message.toLowerCase();
  const haystack = `${lower} ${code}`;

  if (!message && !code && status === null) return fallback;

  // --- Took too long. The app aborts a stalled request itself, and the
  // AbortError that comes back used to be reported as a permissions problem.
  if (
    haystack.includes('abort') ||
    haystack.includes('timeout') ||
    haystack.includes('timed out') ||
    haystack.includes('etimedout') ||
    status === 504 ||
    status === 408
  ) {
    return MESSAGES.slow;
  }

  // --- Too large. Storage answers 413; the wording varies by gateway.
  if (
    status === 413 ||
    haystack.includes('payload too large') ||
    haystack.includes('maximum allowed size') ||
    haystack.includes('exceeded the maximum') ||
    haystack.includes('entity too large') ||
    haystack.includes('file size')
  ) {
    return MESSAGES.tooLarge;
  }

  // --- Refused. 42501 is Postgres "insufficient privilege"; PostgREST also
  // reports an RLS refusal as a 403, and storage as 403 "Unauthorized".
  if (
    haystack.includes('42501') ||
    haystack.includes('row-level security') ||
    haystack.includes('row level security') ||
    haystack.includes('violates row') ||
    haystack.includes('permission denied') ||
    haystack.includes('not allowed') ||
    haystack.includes('forbidden') ||
    status === 403 ||
    haystack.includes('policy')
  ) {
    return MESSAGES.permission;
  }

  // --- Signed out or an expired token.
  if (
    haystack.includes('jwt') ||
    haystack.includes('pgrst301') ||
    haystack.includes('invalid claim') ||
    haystack.includes('not authenticated') ||
    haystack.includes('sign in') ||
    haystack.includes('auth session missing') ||
    status === 401
  ) {
    return MESSAGES.signIn;
  }

  // --- Could not reach the server at all.
  if (
    haystack.includes('network request failed') ||
    haystack.includes('failed to fetch') ||
    haystack.includes('network error') ||
    haystack.includes('enotfound') ||
    haystack.includes('econnrefused') ||
    haystack.includes('econnreset') ||
    haystack.includes('unable to resolve host') ||
    haystack.includes('typeerror: network')
  ) {
    return MESSAGES.unreachable;
  }
  if (haystack.includes('offline') || haystack.includes('no internet')) return MESSAGES.offline;

  // --- Server said it is having a bad moment.
  if ((status !== null && status >= 500) || haystack.includes('internal server error') || haystack.includes('bad gateway')) {
    return MESSAGES.unreachable;
  }

  // --- Ordinary data problems.
  if (haystack.includes('23505') || haystack.includes('duplicate key') || haystack.includes('already exists') || haystack.includes('duplicate')) {
    return MESSAGES.duplicate;
  }
  if (haystack.includes('23502') || haystack.includes('null value in column') || haystack.includes('not-null')) {
    return MESSAGES.missingField;
  }
  if (haystack.includes('bucket') || haystack.includes('storage')) return MESSAGES.storage;
  if (haystack.includes('pgrst116') || status === 404 || haystack.includes('no rows')) {
    return MESSAGES.notFound;
  }

  // Not configured is something the person installing the app needs to see.
  if (haystack.includes('not configured')) return 'The app is not connected to OGN yet. Please reinstall or contact support.';

  return fallback;
}
