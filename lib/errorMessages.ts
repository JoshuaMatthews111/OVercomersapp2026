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

/* ---------------------------------------------------------------------------
 * When something a person wrote is held for a leader to read
 * ---------------------------------------------------------------------------
 * The ministry's sensitive-content filter lives in the DATABASE and nowhere
 * else: two BEFORE INSERT triggers calling public.content_needs_review(text),
 * one on chat_messages and one on app_stories. DO-NOT-BREAK item 18 says it
 * must stay there, and it does. Nothing in this file, and nothing in any
 * screen, decides whether anything is held.
 *
 * What lives here is two things, and it matters that they are not confused.
 *
 * 1. The words we say to a person AFTER the database has held something, so
 *    that nobody is ever left thinking their message simply vanished. That
 *    silence is the defect this section exists to end.
 *
 * 2. SELF_HARM_HINT — one narrow pattern, used only to offer somebody
 *    something kinder. IT IS A HINT FOR THE PERSON'S BENEFIT AND NEVER A
 *    GATE. Nothing reads it to decide whether to send, hold, hide, refuse or
 *    delay anything. Delete it and every message still sends exactly as it
 *    does today; the person would just get colder words.
 *
 * SELF_HARM_HINT is not a copy of the server's list. The server also holds
 * profanity, slurs, threats, drug sales, scams and link shorteners — none of
 * which are here, because none of them call for a gentle word. These five are
 * the self-harm phrases the database holds on purpose, as a safeguarding
 * decision, mirrored exactly so that the sentence shown BEFORE sending is
 * true rather than a guess. If that part of the database list ever changes,
 * change this line with it — and if the two ever disagree, the database wins,
 * because the database is the one that actually decides.
 * ------------------------------------------------------------------------ */
export const SELF_HARM_HINT = /\b(?:kill myself|suicide|self[- ]harm|cut(?:ting)? myself|end my life)\b/i;

/**
 * True when what somebody has written reads unmistakably like self-harm.
 * Only ever used to choose warmer wording and to offer a way to reach a
 * person. Never used to stop anything being sent.
 */
export function mentionsSelfHarm(...parts: (string | null | undefined)[]): boolean {
  return parts.some((part) => typeof part === 'string' && part.length > 0 && SELF_HARM_HINT.test(part));
}

/**
 * Every sentence the app says about something being read by a leader first.
 * Kept together so chat and stories sound like the same church.
 *
 * Deliberately absent from all of it: "blocked", "rejected", "violation",
 * "flagged", "sensitive". A person who has just written the hardest sentence
 * of their life is not a moderation queue item, and the words we show back
 * never say they are. The matched words are never shown back either.
 */
export const REVIEW_NOTICE = {
  /**
   * After the database has held a chat message. Deliberately neutral rather
   * than thankful: the same sentence has to sit right under a testimony and
   * under something said in anger, and it must not scold either one.
   */
  chatHeldTitle: 'A leader will see this first',
  chatHeldBody:
    'One of our team reads this before the room does. It has not gone anywhere — it is still in the conversation above, with a small note on it.',

  /** After the database has held a story. */
  storyHeldTitle: 'Thank you for sharing this',
  storyHeldBody: 'Your story is safely with us. One of our team will read it first, and then it goes out to everyone.',

  /** Before sending, when the app can tell locally that a leader will read it first. */
  beforeSendChat: 'One of our team will read this before the room does, so that somebody knows to walk with you. You can still send it.',
  beforeSendStory: 'One of our team will read this before it goes out, so that somebody knows to walk with you. You can still share it.',

  /**
   * When somebody is in trouble. This must not read like moderation, because
   * it is not moderation — it is a church answering.
   */
  careTitle: 'We are glad you said something',
  careBody:
    'You are not in trouble, and you are not on your own. A leader from the ministry will see this soon. If you would like someone with you before then, you can message the ministry, or send a prayer request — it goes straight to the prayer team and stays private.',
  /**
   * No phone number is written here, and none may be invented. The app does
   * not yet carry a crisis line or a pastor's number — see the note to the
   * owner in this release's handover. "Your local emergency number" invents
   * nothing and is true wherever somebody is reading this.
   */
  careUrgent: 'If you are in danger right now, please call your local emergency number.',
  careReachOut: 'Message the ministry',
  carePrayer: 'Ask for prayer',
} as const;
