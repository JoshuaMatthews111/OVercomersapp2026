import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatRoom } from '../types/models';
import { supabase } from './supabase';
import { getAccessProfile } from './accessControl';
import { FriendlyError } from './errorMessages';
import { UploadError, bucketSizeLimit, currentUserId, formatBytes, uploadFileToBucket } from './uploadService';
// uploadService re-exports only part of this module, so the shrink helpers are
// imported from where they live.
import { AVATAR_IMAGE_MAX_EDGE, CONTENT_IMAGE_MAX_EDGE, isImageMime, prepareImageForUpload } from './uploadBody';

import { hasSupabase } from './publicEnv';

export type ChatAttachmentKind = 'image' | 'video' | 'audio' | 'file';

export type ChatAttachment = {
  path: string;
  url: string;
  kind: ChatAttachmentKind;
  name?: string;
  size?: number;
  /** Pixel size of the picture that was sent, when we know it. Keeps the bubble the right shape. */
  width?: number;
  height?: number;
};

// A card for something shared from the app into a chat.
export type SharedRef = {
  kind: 'sermon' | 'music' | 'video' | 'story' | 'article' | 'scripture' | 'give' | 'event';
  /** kind 'event': the events row it points at, and when/where, so the card can say it. */
  eventId?: string;
  startsAt?: string;
  location?: string;
  scripture?: { bookId: string; chapter: number; verse: number; version: 'KJV' | 'NLT' | 'AMP'; text: string; copyright?: string };
  title: string;
  speaker?: string;
  url?: string;
  artwork?: string;
  noteType?: 'takeaway' | 'question' | 'note' | 'quote';
};

export type ChatMessage = {
  id: string;
  channelId: string;
  userId?: string;
  body: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  isFlagged?: boolean;
  attachment?: ChatAttachment;
  shared?: SharedRef;
  /** Set on a message this phone is still sending. Drives the progress bar on the bubble. */
  sendingProgress?: number;
  /**
   * True for a message its writer (or a leader) deleted for everyone. Only the
   * id, the writer and the time come back — never the words — and the room
   * shows "This message was deleted" in its place.
   */
  deleted?: boolean;
};

const ATTACHMENT_BUCKET = 'chat-attachments';
const ATTACHMENT_LINK_TTL = 60 * 60 * 24; // one day; links are re-signed on every load

export function attachmentKindFromMime(mime?: string | null): ChatAttachmentKind {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** The largest file a chat message can carry, as the app understands it today. */
export function chatAttachmentLimitBytes() {
  return bucketSizeLimit(ATTACHMENT_BUCKET);
}

// The bucket is private. Members get short-lived links, all signed in one call.
async function signAttachmentLinks(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const links = new Map<string, string>();
  if (!unique.length) return links;
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(unique, ATTACHMENT_LINK_TTL);
  for (const entry of data || []) {
    if (entry.path && entry.signedUrl) links.set(entry.path, entry.signedUrl);
  }
  return links;
}

function rowAttachment(row: any, links: Map<string, string>): ChatAttachment | undefined {
  if (!row.attachment_path) return undefined;
  const url = links.get(row.attachment_path);
  if (!url) return undefined;
  return {
    path: row.attachment_path,
    url,
    kind: (row.attachment_type as ChatAttachmentKind) || 'file',
    name: row.attachment_name || undefined,
    size: row.attachment_size || undefined,
  };
}

/** HEIC becomes a JPEG on the way out, so the name has to follow the bytes. */
function nameForMime(rawName: string | null | undefined, mimeType: string) {
  const base = (rawName || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
  if (mimeType !== 'image/jpeg') return base;
  if (/\.jpe?g$/i.test(base)) return base;
  if (/\.hei[cf]$/i.test(base)) return base.replace(/\.hei[cf]$/i, '.jpg');
  return base;
}

/**
 * Send one picked photo, video or document to a room.
 *
 * A photo is shrunk first, then the file streams straight off disk — nothing is
 * loaded into memory — and `onProgress` reports real bytes on the wire so the
 * bubble can show a moving bar instead of a silent wait. The object path stays
 * `<channel>/<user>/<time>-<name>`, which is what the storage policy checks.
 */
export async function uploadChatAttachment(
  channelId: string,
  file: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null; width?: number | null; height?: number | null },
  options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
) {
  if (!hasSupabase) throw new UploadError('Sending files is not switched on in this version of the app yet.', 'unsupported');
  const userId = await currentUserId();
  if (!userId) throw new UploadError('Please sign in before sending a photo or a file.', 'auth');

  const declaredMime = file.mimeType || 'application/octet-stream';
  const prepared = isImageMime(declaredMime)
    ? await prepareImageForUpload({
        uri: file.uri,
        mimeType: declaredMime,
        width: file.width,
        height: file.height,
        maxEdge: CONTENT_IMAGE_MAX_EDGE,
      })
    : {
        uri: file.uri,
        mimeType: declaredMime,
        sizeBytes: file.size || 0,
        width: file.width ?? undefined,
        height: file.height ?? undefined,
        wasResized: false,
      };

  const mimeType = prepared.mimeType || declaredMime;
  const safeName = nameForMime(file.name, mimeType);
  const path = `${channelId}/${userId}/${Date.now()}-${safeName}`;

  try {
    const stored = await uploadFileToBucket({
      uri: prepared.uri,
      bucketId: ATTACHMENT_BUCKET,
      objectPath: path,
      mimeType,
      sizeBytes: prepared.sizeBytes || file.size || undefined,
      upsert: false,
      onProgress: options?.onProgress,
      signal: options?.signal,
    });
    return {
      path,
      kind: attachmentKindFromMime(mimeType),
      name: safeName,
      size: stored.sizeBytes,
      width: prepared.width,
      height: prepared.height,
    };
  } catch (err) {
    // The app believes this room can take a large file. If it comes back
    // refused anyway, say the true size and offer the thing that works,
    // rather than repeating a limit we cannot stand behind.
    if (err instanceof UploadError && err.kind === 'too-large') {
      const measured = prepared.sizeBytes || file.size || 0;
      const size = measured > 0 ? `That file is ${formatBytes(measured)} and it` : 'That file';
      throw new UploadError(`${size} was turned away for being too big. A shorter clip almost always goes through.`, 'too-large');
    }
    throw err;
  }
}

export type ChatProfileSearchResult = {
  id: string;
  displayName: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  region?: string;
};

export type ChatMember = {
  userId: string;
  displayName: string;
  phone?: string;
  avatarUrl?: string;
  role?: string;
  joinedAt?: string;
};

/* ---------------------------------------------------------------------------
 * Blocking — one list, read in one place
 *
 * "Block this person" used to write a row into `user_blocks` that nothing ever
 * read back, so the person stayed exactly where they were. Everything this
 * module hands a screen now passes through `hideBlocked()` below, and that is
 * the ONLY place the rule lives. A screen cannot forget to apply it, because a
 * screen never applies it.
 *
 * Three things this must never do.
 *
 * It must never tell the blocked person. Their row is readable only by the
 * person who wrote it — `using (blocker_id = auth.uid())` in
 * supabase/release_hardening.sql — nothing is written to their account, and no
 * screen sends them anything. From their side the conversation is unchanged:
 * their message still posts, and they are never shown a count, a state or a
 * refusal that would tell them somebody stopped reading.
 *
 * It must never blind a moderator. DO-NOT-BREAK item 5 keeps moderation working
 * for leaders and admins, so for anyone `is_chat_moderator()` covers the filter
 * is switched off: the block is still recorded, and the room is still whole.
 *
 * And it must never empty a room it cannot explain. If the `user_blocks` read
 * itself fails — offline, or a backend that does not have the table — this
 * fails OPEN and shows the conversation, rather than fails closed and shows a
 * member a blank room they have no way to fix. The failure is not cached, so
 * the very next read tries again.
 * ------------------------------------------------------------------------- */

type BlockState = {
  userId: string;
  blocked: Set<string>;
};

const NO_BLOCKS: BlockState = { userId: '', blocked: new Set<string>() };

let blockState: BlockState | null = null;
let blockStateInFlight: { userId: string; promise: Promise<BlockState> } | null = null;
let moderatorAnswer: { userId: string; promise: Promise<boolean> } | null = null;

/**
 * Mirrors `public.is_chat_moderator()`, through lib/accessControl.ts.
 *
 * Asked ONLY when it can change the answer — that is, when this person has
 * actually blocked somebody. A member with an empty list never pays for it, and
 * it is never in the way of a room opening. A roles read that fails is not
 * cached, so a moderator on a bad signal gets the right answer a moment later
 * rather than for the rest of the session.
 */
async function readerIsModerator(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (!moderatorAnswer || moderatorAnswer.userId !== userId) {
    moderatorAnswer = {
      userId,
      promise: getAccessProfile()
        .then((access) => Boolean(access.canModerateChat))
        .catch(() => {
          moderatorAnswer = null;
          return false;
        }),
    };
  }
  return moderatorAnswer.promise;
}

async function readBlockState(userId: string): Promise<BlockState> {
  const { data, error } = await supabase.from('user_blocks').select('blocked_user_id').eq('blocker_id', userId);
  if (error) throw error;
  return {
    userId,
    blocked: new Set(((data || []) as any[]).map((row) => row.blocked_user_id).filter(Boolean)),
  };
}

/**
 * Whoever this phone last answered for.
 *
 * A phone gets handed around a church. When the person changes, everything
 * remembered about the last one goes — including what they reported, which
 * would otherwise show the next person an "Already reported" they never did.
 */
let lastReader: string | null = null;

function noteReader(userId: string | null) {
  if (lastReader === userId) return;
  lastReader = userId;
  blockState = null;
  blockStateInFlight = null;
  moderatorAnswer = null;
  hiddenState = null;
  reportedTargets.clear();
}

/** The blocked list for whoever is signed in, read once and kept for the session. */
async function currentBlockState(): Promise<BlockState> {
  if (!hasSupabase) return NO_BLOCKS;
  const userId = await currentUserId();
  noteReader(userId);
  if (!userId) return NO_BLOCKS;
  if (blockState && blockState.userId === userId) return blockState;
  if (!blockStateInFlight || blockStateInFlight.userId !== userId) {
    const promise = readBlockState(userId)
      .then((state) => {
        blockState = state;
        return state;
      })
      // Deliberately NOT cached: an empty answer here means "we could not ask",
      // not "nobody is blocked", and the next screen must be free to ask again.
      .catch(() => ({ userId, blocked: new Set<string>() }));
    blockStateInFlight = { userId, promise };
    void promise.finally(() => {
      if (blockStateInFlight && blockStateInFlight.promise === promise) blockStateInFlight = null;
    });
  }
  return blockStateInFlight.promise;
}

/** Everyone this person has blocked. Empty on a signed-out phone. */
export async function getBlockedUserIds(): Promise<string[]> {
  const state = await currentBlockState();
  return [...state.blocked];
}

export async function isUserBlocked(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const state = await currentBlockState();
  return state.blocked.has(userId);
}

/**
 * Whether blocking actually hides anything for the person using this phone.
 *
 * False for a moderator — their block is saved, and the room stays whole so
 * they can still do the job. Screens read this so they can say which of the two
 * happened instead of claiming the content is gone when it is not.
 */
export async function blockHidesContent(): Promise<boolean> {
  const state = await currentBlockState();
  if (!state.userId) return true;
  return !(await readerIsModerator(state.userId));
}

/** Drop anything written by somebody this person has blocked. */
async function hideBlocked<T>(items: T[], authorOf: (item: T) => string | undefined): Promise<T[]> {
  const state = await currentBlockState();
  // Nobody blocked: the common case, and it costs one small query per session.
  if (!state.blocked.size) return items;
  if (await readerIsModerator(state.userId)) return items;
  return items.filter((item) => {
    const author = authorOf(item);
    return !author || !state.blocked.has(author);
  });
}

/** The same question for one item, for the live connection. */
async function showsContentFrom(userId?: string): Promise<boolean> {
  if (!userId) return true;
  const state = await currentBlockState();
  if (!state.blocked.has(userId)) return true;
  return readerIsModerator(state.userId);
}

/* ---------------------------------------------------------------------------
 * Delete for me — the second list this module filters by, in the same place
 *
 * `public.chat_message_hidden` holds (user, message) pairs, readable and
 * writable only by that user. The room reads the list once per session and
 * keeps it up to date as the person hides things, exactly like the blocked
 * list above. A failed read fails OPEN (shows the room), for the same reason.
 * ------------------------------------------------------------------------- */

let hiddenState: { userId: string; ids: Set<string> } | null = null;

async function currentHiddenIds(): Promise<Set<string>> {
  if (!hasSupabase) return new Set();
  const userId = await currentUserId();
  noteReader(userId);
  if (!userId) return new Set();
  if (hiddenState && hiddenState.userId === userId) return hiddenState.ids;
  const { data, error } = await supabase.from('chat_message_hidden').select('message_id').eq('user_id', userId);
  // Not cached on failure: the next load asks again.
  if (error) return new Set();
  hiddenState = { userId, ids: new Set(((data || []) as any[]).map((row) => row.message_id).filter(Boolean)) };
  return hiddenState.ids;
}

/** Drop every message this person chose "Delete for me" on. */
async function hideHiddenMessages<T extends { id: string }>(items: T[]): Promise<T[]> {
  const hidden = await currentHiddenIds();
  if (!hidden.size) return items;
  return items.filter((item) => !hidden.has(item.id));
}

function normalizeRoomType(type?: string): ChatRoom['type'] {
  if (type === 'announcement' || type === 'leader' || type === 'regional' || type === 'prayer' || type === 'direct' || type === 'group' || type === 'general' || type === 'global') {
    return type;
  }
  return 'global';
}

function roomFromRow(row: any): ChatRoom {
  const type = normalizeRoomType(row.channel_type);
  return {
    id: row.id,
    name: row.name,
    region: row.region || 'Worldwide',
    members: 0,
    // No read tracking exists yet, so no invented unread counts.
    unread: 0,
    type,
    avatarUrl: row.avatar_url || undefined,
    createdBy: row.created_by || undefined,
    // A one-to-one chat keeps a private lookup key in `description`. It is
    // never shown to anybody.
    description: type === 'direct' ? undefined : (row.description || undefined),
    isPublic: typeof row.is_public === 'boolean' ? row.is_public : undefined,
  };
}

export async function getChatRooms(): Promise<ChatRoom[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from('chat_channels').select('*').order('created_at');
  // Never show invented rooms to a real member. A failed query on the live
  // backend must read as empty, not as a thriving community.
  if (error) throw error;
  if (!data) return [];
  return data.map(roomFromRow);
}

/**
 * What to put at the top of a room row.
 *
 * A one-to-one chat is stored under both names ("Ada Cole & Joshua Matthews")
 * because either person may open it. Each of them should see the other one.
 */
export function chatRoomTitle(room: { name: string; type: ChatRoom['type'] }, myDisplayName?: string) {
  if (room.type !== 'direct' || !myDisplayName) return room.name;
  const tidy = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const parts = room.name.split('&').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return room.name;
  const mine = tidy(myDisplayName);
  const others = parts.filter((part) => tidy(part) !== mine);
  // If neither half matches — the two names can come from different places —
  // showing both is still correct, just longer.
  return others.length && others.length < parts.length ? others.join(', ') : room.name;
}

export async function getChatMessages(channelId: string): Promise<ChatMessage[]> {
  if (!hasSupabase) throw new FriendlyError('Chat is not available in this version of the app yet.');

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, channel_id, user_id, body, created_at, is_flagged, attachment_path, attachment_type, attachment_name, attachment_size, shared_ref')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!data) return [];
  const [profiles, links] = await Promise.all([
    getProfilesByIds(data.map((row: any) => row.user_id).filter(Boolean)),
    signAttachmentLinks(data.map((row: any) => row.attachment_path).filter(Boolean)),
  ]);
  const oldest = data.length ? (data[data.length - 1] as any).created_at : null;
  const [tombstones, tombstoneProfiles] = await readTombstones(channelId, oldest, data.length >= 50);
  const messages: ChatMessage[] = data.reverse().map((row: any) => ({
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    body: row.body,
    displayName: profiles.get(row.user_id)?.displayName || 'OGN Member',
    avatarUrl: profiles.get(row.user_id)?.avatarUrl,
    createdAt: row.created_at,
    isFlagged: row.is_flagged,
    attachment: rowAttachment(row, links),
    shared: row.shared_ref || undefined,
  }));
  for (const row of tombstones) {
    messages.push({
      id: row.id,
      channelId,
      userId: row.user_id || undefined,
      body: '',
      displayName: tombstoneProfiles.get(row.user_id)?.displayName || profiles.get(row.user_id)?.displayName || 'OGN Member',
      avatarUrl: tombstoneProfiles.get(row.user_id)?.avatarUrl || profiles.get(row.user_id)?.avatarUrl,
      createdAt: row.created_at,
      deleted: true,
    });
  }
  messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  // The one place a room's history is filtered: blocked people (see the
  // blocking section above) and anything this person deleted for themselves.
  return hideHiddenMessages(await hideBlocked(messages, (message) => message.userId));
}

/**
 * Messages deleted for everyone inside the window this room is showing, as
 * ids and times only. A backend without the function simply shows no
 * "This message was deleted" lines — the conversation is unaffected.
 */
async function readTombstones(channelId: string, oldest: string | null, fullPage: boolean) {
  const empty: [any[], Map<string, { displayName: string; avatarUrl?: string }>] = [[], new Map()];
  try {
    // With a full page, only tombstones newer than the oldest message shown.
    // With fewer, the whole (recent) history is on screen.
    const since = fullPage && oldest ? oldest : null;
    const { data, error } = await supabase.rpc('get_chat_deleted_messages', { p_channel_id: channelId, p_since: since });
    if (error || !data) return empty;
    const rows = (data as any[]).filter((row) => row && row.id);
    if (!rows.length) return empty;
    const profiles = await getProfilesByIds(rows.map((row) => row.user_id).filter(Boolean));
    return [rows, profiles] as typeof empty;
  } catch {
    return empty;
  }
}

/**
 * What the server actually did with a message we just sent.
 *
 * `isFlagged` is the important one. A BEFORE INSERT trigger in the
 * database can set is_flagged on a message, and the read policy then shows it
 * only to the person who wrote it and to the leaders. The insert still
 * succeeds and the row still comes back, so from the phone's side a held
 * message and an ordinary one look identical unless somebody reads this.
 *
 * It does NOT mean rejected, removed or refused. The message is saved, the
 * person can still see it, and a leader reads it before the room does.
 */
export type SentChatMessage = {
  id: string;
  /**
   * True when a leader reads this before the rest of the room sees it.
   *
   * Named after the database column it comes from, because components/
   * ShareToChat.tsx already reads it by that name. Everywhere it is SHOWN to
   * a person it is described as waiting for a leader, never as flagged.
   */
  isFlagged: boolean;
  /** The server's own timestamp, so the bubble is not stamped by a phone clock. */
  createdAt: string;
};

export async function sendChatMessage(
  channelId: string,
  body: string,
  attachment?: { path: string; kind: ChatAttachmentKind; name?: string; size?: number },
  shared?: SharedRef,
): Promise<SentChatMessage> {
  if (!hasSupabase) throw new FriendlyError('Chat is not available in this version of the app yet. Your message was not sent.');
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before posting to chat.');

  await ensureChatMember(channelId, userId);
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id: channelId,
      user_id: userId,
      body,
      attachment_path: attachment?.path ?? null,
      attachment_type: attachment?.kind ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_size: attachment?.size ?? null,
      shared_ref: shared ?? null,
    })
    .select('id, is_flagged, created_at')
    .single();
  if (error) throw error;
  return {
    id: data.id as string,
    isFlagged: Boolean(data.is_flagged),
    createdAt: (data.created_at as string) || new Date().toISOString(),
  };
}

export async function forwardMediaToChat(input: {
  title: string;
  url?: string;
  kind?: string;
  targetChannelId?: string;
}) {
  const rooms = await getChatRooms();
  const target = input.targetChannelId
    ? rooms.find((room) => room.id === input.targetChannelId)
    : rooms.find((room) => room.type === 'announcement') || rooms.find((room) => room.type === 'global') || rooms[0];
  if (!target) throw new FriendlyError('There is no group to share this into yet.');
  const kind = (input.kind === 'audio' ? 'music' : input.kind === 'embed' ? 'video' : input.kind) as SharedRef['kind'];
  return sendChatMessage(target.id, '', undefined, { kind: kind || 'sermon', title: input.title, url: input.url });
}

/** What the live connection is doing, so a screen can say so honestly. */
export type ChatConnectionState = 'connecting' | 'live' | 'reconnecting';

const CHAT_CHANGED_EVENT = 'message-changed';

/**
 * Tell every other open copy of this room to read it again, after a message
 * was deleted for everyone or held. Best effort: if it does not arrive, the
 * other phones catch up the next time they open or refresh the room.
 */
export async function announceChatChange(channel: RealtimeChannel | null | undefined): Promise<boolean> {
  if (!channel) return false;
  try {
    const result = await channel.send({ type: 'broadcast', event: CHAT_CHANGED_EVENT, payload: {} });
    return result === 'ok';
  } catch {
    // A closed socket is not the person's problem: the change itself is
    // already saved, and the other phones see it on their next refresh.
    return false;
  }
}

/**
 * Listen for new messages in one room.
 *
 * Everything in here is contained: a socket that will not open, or that drops,
 * reports 'reconnecting' through `onState` and nothing else in the app is
 * touched. It can never sign anyone out and it never throws into the screen.
 */
export function subscribeToChat(
  channelId: string,
  onMessage: (message: ChatMessage) => void,
  onState?: (state: ChatConnectionState) => void,
  onChanged?: () => void,
): RealtimeChannel | undefined {
  if (!hasSupabase) return undefined;
  try {
    onState?.('connecting');
    const channel = supabase
      .channel(`chat:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row: any = payload.new;
          const base: ChatMessage = {
            id: row.id,
            channelId: row.channel_id,
            userId: row.user_id,
            body: row.body,
            displayName: 'OGN Member',
            createdAt: row.created_at,
            isFlagged: row.is_flagged,
            shared: row.shared_ref || undefined,
          };
          // A blocked person's new message must not arrive live either, or the
          // block would hold on a refresh and break the moment they typed.
          void showsContentFrom(row.user_id)
            .then((show) => {
              if (!show) return;
              return Promise.all([
                getProfilesByIds(row.user_id ? [row.user_id] : []),
                signAttachmentLinks(row.attachment_path ? [row.attachment_path] : []),
              ])
                .then(([profiles, links]) => {
                  const profile = row.user_id ? profiles.get(row.user_id) : undefined;
                  onMessage({ ...base, displayName: profile?.displayName || base.displayName, avatarUrl: profile?.avatarUrl, attachment: rowAttachment(row, links) });
                })
                // The message itself arrived; only the name and the picture link
                // did not. Showing it without them beats not showing it at all.
                .catch(() => onMessage(base));
            })
            .catch(() => onMessage(base));
        },
      )
      // Somebody deleted or held a message. A database UPDATE cannot reach the
      // other phones here: once a message is deleted or held, row-level
      // security no longer lets them read the row, so Realtime drops the
      // event for them. The phone that made the change says so on the room's
      // channel instead, and every open copy of the room reads it again. The
      // signal carries nothing but "look again" — what comes back is still
      // decided by the database — so a forged one can only cause a re-read.
      .on('broadcast', { event: CHAT_CHANGED_EVENT }, () => {
        onChanged?.();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') return onState?.('live');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return onState?.('reconnecting');
      });
    return channel;
  } catch {
    // A socket that will not open is a quiet, recoverable state — the room
    // still reads and still sends, it just will not update by itself.
    onState?.('reconnecting');
    return undefined;
  }
}

export async function joinChatRoom(channelId: string) {
  if (!hasSupabase) return { channel_id: channelId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before opening a chat room.');
  return ensureChatMember(channelId, userId);
}

/* ---------------------------------------------------------------------------
 * Starting a conversation
 *
 * A one-to-one chat is found again by a key written into the channel's
 * description, because a member may only read their OWN rows in chat_members
 * and so cannot ask "which of my chats has this person in it?" any other way.
 * The key is never shown to anybody; the room's name is what people read.
 * ------------------------------------------------------------------------- */

function directKey(a: string, b: string) {
  return `dm:${[a, b].sort().join(':')}`;
}

async function myDisplayName(userId: string) {
  const profiles = await getProfilesByIds([userId]);
  return profiles.get(userId)?.displayName || 'OGN Member';
}

async function findDirectChannel(key: string) {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('id, name, region, channel_type')
    .eq('channel_type', 'direct')
    .eq('description', key)
    .limit(1);
  if (error) throw error;
  return data && data.length ? roomFromRow(data[0]) : null;
}

function refusedToCreate(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
  const code = String((error as { code?: unknown })?.code ?? '');
  return code === '42501' || message.includes('row-level security') || message.includes('row level security');
}

/**
 * Open the one-to-one chat with somebody, creating it the first time.
 *
 * Safe to call twice: if the chat already exists — including one the other
 * person started a second earlier — this returns that one instead of failing.
 */
export async function openDirectChannel(other: { id: string; displayName?: string }): Promise<ChatRoom> {
  if (!hasSupabase) throw new FriendlyError('Chat is not available in this version of the app yet.');
  const me = await currentUserId();
  if (!me) throw new FriendlyError('Please sign in to start a conversation.');
  if (me === other.id) throw new FriendlyError('This is your own profile. Pick someone else to message.');

  const key = directKey(me, other.id);
  const existing = await findDirectChannel(key);
  if (existing) return existing;

  const mine = await myDisplayName(me);
  const theirs = (other.displayName || '').trim() || 'OGN Member';

  const { data, error } = await supabase
    .from('chat_channels')
    .insert({
      name: `${theirs} & ${mine}`,
      description: key,
      channel_type: 'direct',
      region: null,
      is_public: false,
      is_mandatory: false,
      created_by: me,
    })
    .select('id, name, region, channel_type')
    .single();

  if (error) {
    // Two phones can reach this line at the same moment. Look once more
    // before telling anybody anything went wrong.
    const raced = await findDirectChannel(key).catch(() => null);
    if (raced) return raced;
    if (refusedToCreate(error)) {
      throw new FriendlyError('Your account is not allowed to start a new conversation yet. Please ask a leader to open one for you.');
    }
    throw error;
  }

  const room = roomFromRow(data);
  await addChatMember(room.id, me);
  try {
    await addChatMember(room.id, other.id);
  } catch {
    // The room is ours and it opens, but the other person is not in it yet,
    // so they would never see what was written. Say so instead of letting
    // somebody talk into an empty room.
    throw new FriendlyError(`The chat was made, but we could not add ${theirs} to it yet. Please try again in a moment.`);
  }
  return room;
}

/**
 * Start a named group with the people who were picked. The person creating it
 * is always in it.
 */
export async function createChatRoom(input: { name: string; memberIds: string[]; region?: string }): Promise<NewChatRoom> {
  if (!hasSupabase) throw new FriendlyError('Chat is not available in this version of the app yet.');
  const me = await currentUserId();
  if (!me) throw new FriendlyError('Please sign in to start a conversation.');
  const name = input.name.trim();
  if (!name) throw new FriendlyError('Give the group a name so people know what it is.');

  const invited = Array.from(new Set(input.memberIds.filter((id) => id && id !== me)));
  if (!invited.length) throw new FriendlyError('Choose at least one person to talk with.');

  const { data, error } = await supabase
    .from('chat_channels')
    .insert({
      name,
      description: null,
      channel_type: 'group',
      region: input.region || null,
      is_public: false,
      is_mandatory: false,
      created_by: me,
    })
    .select('id, name, region, channel_type')
    .single();

  if (error) {
    if (refusedToCreate(error)) {
      throw new FriendlyError('Your account is not allowed to start a new group yet. Please ask a leader to open one for you.');
    }
    throw error;
  }

  const room = roomFromRow(data);
  await addChatMember(room.id, me);

  // One person who cannot be added must not lose the whole group. Everyone who
  // could be added is in, and the caller is told how many were not.
  const notAdded: string[] = [];
  for (const id of invited) {
    try {
      await addChatMember(room.id, id);
    } catch {
      notAdded.push(id);
    }
  }
  if (notAdded.length === invited.length) {
    throw new FriendlyError('The group was made, but nobody could be added to it yet. Please try again in a moment.');
  }
  return { ...room, notAdded: notAdded.length };
}

/** A room that was just made, plus how many invited people could not be added. */
export type NewChatRoom = ChatRoom & { notAdded?: number };

/**
 * A leader starts a named group: name, a short description, public or
 * private, and the first people in it. The leader is always a member.
 *
 * A PUBLIC group needs nobody picked — anyone in the network can find it in
 * Chat and join it, the same way they join every other public room
 * (joinChatRoom). A private group needs at least one other person.
 *
 * Members keep the "New chat" way of starting a group exactly as it was.
 */
export async function createChatGroup(input: {
  name: string;
  description?: string;
  isPublic: boolean;
  memberIds: string[];
  region?: string;
}): Promise<NewChatRoom> {
  if (!hasSupabase) throw new FriendlyError('Chat is not available in this version of the app yet.');
  const me = await currentUserId();
  if (!me) throw new FriendlyError('Please sign in to start a group.');
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new FriendlyError('Give the group a name so people know what it is.');
  if (name.length > 80) throw new FriendlyError('Please keep the group name under 80 letters.');
  const description = (input.description || '').trim();
  if (description.length > 300) throw new FriendlyError('Please keep the description under 300 letters.');

  const invited = Array.from(new Set(input.memberIds.filter((id) => id && id !== me)));
  if (!input.isPublic && !invited.length) throw new FriendlyError('A private group needs at least one other person. Add someone, or make the group public.');

  const { data, error } = await supabase
    .from('chat_channels')
    .insert({
      name,
      description: description || null,
      channel_type: 'group',
      region: input.region || null,
      is_public: input.isPublic,
      is_mandatory: false,
      created_by: me,
    })
    .select('id, name, region, channel_type, description, is_public, created_by, avatar_url')
    .single();
  if (error) {
    if (refusedToCreate(error)) throw new FriendlyError('Your account is not allowed to start a group. Please ask an admin.');
    throw error;
  }

  const room = roomFromRow(data);
  await addChatMember(room.id, me);
  const notAdded: string[] = [];
  for (const id of invited) {
    try {
      await addChatMember(room.id, id);
    } catch {
      notAdded.push(id);
    }
  }
  return { ...room, notAdded: notAdded.length };
}

/* ---------------------------------------------------------------------------
 * Group pictures
 *
 * Stored in the public `chat-group-pictures` bucket under `<room id>/`, the
 * same way profile photos live in `profile-avatars` under `<user id>/`. Only a
 * moderator or the person who started the room may write there, and the room
 * row is changed only through set_chat_channel_avatar(), which checks the same
 * thing on the server. Shrunk to 512px first, like a profile photo.
 * ------------------------------------------------------------------------- */

const GROUP_PICTURE_BUCKET = 'chat-group-pictures';

export async function uploadChatGroupPicture(
  channelId: string,
  picked: { uri: string; mimeType?: string | null; width?: number | null; height?: number | null; fileName?: string | null },
  options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<string> {
  if (!hasSupabase) throw new UploadError('Pictures are not switched on in this version of the app yet.', 'unsupported');
  const userId = await currentUserId();
  if (!userId) throw new UploadError('Please sign in before changing a group picture.', 'auth');
  const prepared = await prepareImageForUpload({
    uri: picked.uri,
    mimeType: picked.mimeType || 'image/jpeg',
    width: picked.width,
    height: picked.height,
    maxEdge: AVATAR_IMAGE_MAX_EDGE,
  });
  const mimeType = prepared.mimeType || picked.mimeType || 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectPath = `${channelId}/${Date.now()}-group.${extension}`;
  await uploadFileToBucket({
    uri: prepared.uri,
    bucketId: GROUP_PICTURE_BUCKET,
    objectPath,
    mimeType,
    sizeBytes: prepared.sizeBytes || undefined,
    upsert: false,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });
  const { data } = supabase.storage.from(GROUP_PICTURE_BUCKET).getPublicUrl(objectPath);
  const { error } = await supabase.rpc('set_chat_channel_avatar', { p_channel_id: channelId, p_avatar_url: data.publicUrl });
  if (error) throw permissionWords(error, 'Only a leader or the person who started this group can change its picture.');
  return data.publicUrl;
}

/** Take the picture off a group. It goes back to its icon badge. */
export async function clearChatGroupPicture(channelId: string) {
  if (!hasSupabase) return;
  const { error } = await supabase.rpc('set_chat_channel_avatar', { p_channel_id: channelId, p_avatar_url: null });
  if (error) throw permissionWords(error, 'Only a leader or the person who started this group can change its picture.');
}

/* ---------------------------------------------------------------------------
 * Delete for everyone, Delete for me, Hold for review
 *
 * The two that change what OTHER people see go through database functions
 * (supabase/2026-09-21-chat-actions-and-group-pictures.sql), which decide who
 * may do it on the server — the phone's idea of somebody's role is never
 * trusted. The database also refuses a leader who tries to remove or hold a
 * message written by an admin (DO-NOT-BREAK item 5), and the words it sends
 * back are shown as they are.
 * ------------------------------------------------------------------------- */

function permissionWords(error: unknown, fallback: string) {
  const message = String((error as { message?: unknown })?.message ?? '');
  const code = String((error as { code?: unknown })?.code ?? '');
  // Our own functions raise plain sentences with these codes.
  if ((code === '42501' || code === 'P0002' || code === '22023') && message && !/row-level|violates|permission denied/i.test(message)) {
    return new FriendlyError(message);
  }
  if (code === '42501') return new FriendlyError(fallback);
  return error;
}

/**
 * Soft delete for everyone. The writer may always do it; a leader may do it to
 * anybody except an admin. The room then shows "This message was deleted".
 */
export async function deleteChatMessageForEveryone(messageId: string) {
  if (!hasSupabase) return { id: messageId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before deleting a message.');
  const { error } = await supabase.rpc('chat_delete_message_for_everyone', { p_message_id: messageId });
  if (error) throw permissionWords(error, 'Only the person who wrote this, or a leader, can delete it for everyone.');
  return { id: messageId };
}

/** Anyone, on any message they can see: it disappears for them and nobody else. */
export async function hideChatMessageForMe(messageId: string) {
  if (!hasSupabase) return { id: messageId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in first.');
  const { error } = await supabase
    .from('chat_message_hidden')
    .upsert({ user_id: userId, message_id: messageId }, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
  if (error) throw error;
  if (hiddenState && hiddenState.userId === userId) hiddenState.ids.add(messageId);
  else hiddenState = null;
  return { id: messageId };
}

/**
 * Soft hold, for moderators and above. The message is hidden from everyone
 * but its writer and the leaders, lands in Admin > Needs your look, and
 * Approve there puts it back.
 */
export async function holdChatMessage(messageId: string) {
  if (!hasSupabase) return { id: messageId };
  const { error } = await supabase.rpc('chat_hold_message', { p_message_id: messageId });
  if (error) throw permissionWords(error, 'Only a leader can hold a message for review.');
  return { id: messageId };
}

const adminAuthors = new Map<string, boolean>();

/**
 * Whether a message's writer is an admin, so a leader is not offered Delete
 * for everyone or Hold on it (DO-NOT-BREAK item 5). Read from chat_profiles,
 * which every signed-in person may read. Only a courtesy: the database refuses
 * the action either way. Unknown reads as "not an admin", so the button shows
 * and the server's plain refusal explains itself.
 */
export async function chatAuthorIsAdmin(userId?: string | null): Promise<boolean> {
  if (!userId || !hasSupabase) return false;
  const known = adminAuthors.get(userId);
  if (known !== undefined) return known;
  try {
    const { data, error } = await supabase.from('chat_profiles').select('role').eq('id', userId).maybeSingle();
    if (error) return false;
    const isAdmin = data?.role === 'admin' || data?.role === 'super_admin';
    adminAuthors.set(userId, isAdmin);
    return isAdmin;
  } catch {
    return false;
  }
}

/** Kept for existing callers. 'remove' is Delete for everyone; 'flag' is Hold. */
export async function moderateChatMessage(messageId: string, action: 'remove' | 'flag' = 'remove') {
  return action === 'remove' ? deleteChatMessageForEveryone(messageId) : holdChatMessage(messageId);
}

/** Kept for existing callers: a member takes back their own message, for everyone. */
export async function deleteOwnChatMessage(messageId: string) {
  return deleteChatMessageForEveryone(messageId);
}

/* ---------------------------------------------------------------------------
 * Reporting — one queue for everything a member can report
 *
 * Every report goes into `public.content_reports`, in exactly the shape the
 * database's own filter uses when it files one itself
 * (supabase/2026-09-19-phase1-security.sql:114 and :147):
 *
 *   insert into public.content_reports (reporter_id, target_type, target_id,
 *                                       reason, status)
 *   values (..., 'app_story', new.id, 'auto-filter: ...', 'new');
 *
 * so a person's report and the filter's own land side by side for whoever
 * reads that table. The write policy is `with check (reporter_id = auth.uid())`
 * — a member may file a report and may not read anybody's, which is why the
 * "already reported" guard below is kept on the phone: a member cannot ask the
 * database whether they reported something, so we remember it here.
 * ------------------------------------------------------------------------- */

/** What a report points at. `chat_message` and `app_story` match the filter's. */
export type ReportTargetType = 'chat_message' | 'app_story' | 'profile';

export type ContentReportResult = {
  id?: string;
  /** True when this phone already reported this exact thing. Nothing was written. */
  alreadyReported: boolean;
};

// Reported once is reported. Kept for the life of the app process, which is as
// long as a screen can stay open, so a second tap cannot pile up rows.
const reportedTargets = new Set<string>();

const reportKey = (targetType: ReportTargetType, targetId: string) => `${targetType}:${targetId}`;

/** Has this phone already reported this, in this session? Nothing is asked of the network. */
export function alreadyReported(targetType: ReportTargetType, targetId?: string | null): boolean {
  if (!targetId) return false;
  return reportedTargets.has(reportKey(targetType, targetId));
}

export async function reportContent(
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
): Promise<ContentReportResult> {
  const key = reportKey(targetType, targetId);
  if (reportedTargets.has(key)) return { alreadyReported: true };
  if (!hasSupabase) {
    reportedTargets.add(key);
    return { alreadyReported: false };
  }
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before reporting something.');
  const { data, error } = await supabase
    .from('content_reports')
    .insert({
      reporter_id: userId,
      target_type: targetType,
      target_id: targetId,
      reason,
      status: 'new',
    })
    .select('id')
    .single();
  if (error) throw error;
  // Only after the database took it. A failed report may be tried again.
  reportedTargets.add(key);
  return { id: data?.id as string | undefined, alreadyReported: false };
}

export function reportChatMessage(messageId: string, reason = 'In-app report') {
  return reportContent('chat_message', messageId, reason);
}

/** A member reporting somebody's story. Same table, same queue as the filter's own. */
export function reportStory(storyId: string, reason = 'Member report: story') {
  return reportContent('app_story', storyId, reason);
}

/** A member reporting a person rather than one thing they posted. */
export function reportPerson(personId: string, reason = 'Member report: profile') {
  return reportContent('profile', personId, reason);
}

/* ---------------------------------------------------------------------------
 * Stories get the same two rules
 *
 * Members publish stories now, so the story ring is user-generated content and
 * Apple guideline 1.2 and Play's UGC policy both apply to it. The answer is
 * given HERE, and not in app/story-viewer.tsx, for the same reason the blocking
 * section above gives: ONE list and ONE place, so no screen can forget. It also
 * keeps the viewer free of table names — it asks what it may show and is told.
 *
 * (This module is chat, plus the safety rules the whole app shares. When there
 * is a third caller this belongs in its own lib/safetyService.ts; it is here
 * today because splitting a shared file mid-release costs more than it buys.)
 * ------------------------------------------------------------------------- */

/**
 * A story that is a real row in `public.app_stories`. Only those can be
 * reported: `content_reports.target_id` is a uuid column, so a story card
 * shared into a chat — which arrives with no row behind it — is reported on the
 * message that carried it instead.
 */
const STORY_ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReportableStoryId(id?: string | null): boolean {
  return Boolean(id && STORY_ROW_ID.test(id));
}

/** What one person may be shown of a ring of stories, and who wrote them. */
export type StorySafety = {
  /** Who is reading, so a screen can tell their own story from somebody else's. */
  viewerId: string | null;
  /** story id -> author, for every story we could resolve one for. */
  authorById: Record<string, string>;
  /** Stories this person must not be shown: already reported, or by somebody they blocked. */
  hiddenStoryIds: string[];
  /**
   * True when we could not find out who wrote these at all.
   *
   * It is the difference between "this story has no author on it" and "we could
   * not ask", and the screen needs it so that a missing Block button can be
   * explained instead of just being missing.
   */
  authorsUnavailable: boolean;
};

export async function storySafetyFor(stories: { id: string; authorId?: string }[]): Promise<StorySafety> {
  const viewerId = await currentUserId().catch(() => null);

  const authorById: Record<string, string> = {};
  for (const story of stories) if (story.authorId) authorById[story.id] = story.authorId;

  // `created_by` sits on the very row a member is already allowed to read
  // ("public reads published stories by role" in app_feature_expansion.sql),
  // so this asks for nothing new. If it fails, the cost is only that "Block
  // this person" has nobody to block — never the story, and never the screen.
  let authorsUnavailable = false;
  const ask = stories.map((story) => story.id).filter((id) => isReportableStoryId(id) && !authorById[id]);
  if (hasSupabase && ask.length) {
    try {
      const { data, error } = await supabase.from('app_stories').select('id, created_by').in('id', ask);
      if (error) authorsUnavailable = true;
      for (const row of (data || []) as any[]) if (row.created_by) authorById[row.id] = row.created_by;
    } catch {
      authorsUnavailable = true;
    }
  }

  const state = await currentBlockState();
  const hidesBlocked = state.blocked.size ? !(await readerIsModerator(state.userId)) : false;
  const hiddenStoryIds = stories
    .filter(
      (story) =>
        alreadyReported('app_story', story.id)
        || (hidesBlocked && state.blocked.has(authorById[story.id] || '')),
    )
    .map((story) => story.id);

  return { viewerId, authorById, hiddenStoryIds, authorsUnavailable };
}

export async function blockChatUser(blockedUserId: string) {
  if (!hasSupabase) return { blocked_user_id: blockedUserId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before blocking someone.');
  if (userId === blockedUserId) throw new FriendlyError('You cannot block yourself.');
  const { data, error } = await supabase
    .from('user_blocks')
    .upsert({ blocker_id: userId, blocked_user_id: blockedUserId })
    .select('blocked_user_id')
    .single();
  if (error) throw error;
  // The list every screen reads is updated here, so the block takes effect on
  // the next read without waiting for the database to be asked again.
  if (blockState && blockState.userId === userId) blockState.blocked.add(blockedUserId);
  else blockState = null;
  return data;
}

/**
 * Undo a block. The person comes back into the rooms they share, and nothing
 * about either the block or the unblock was ever visible to them.
 */
export async function unblockChatUser(blockedUserId: string) {
  if (!hasSupabase) return { blocked_user_id: blockedUserId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in first.');
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_user_id', blockedUserId);
  if (error) throw error;
  if (blockState && blockState.userId === userId) blockState.blocked.delete(blockedUserId);
  else blockState = null;
  return { blocked_user_id: blockedUserId };
}

/**
 * People a member may start a conversation with.
 *
 * This reads chat_profiles — names and pictures, which every signed-in person
 * may see. The `profiles` table holds phone numbers and is readable only by
 * staff, so searching it would have returned nothing at all for an ordinary
 * member, which is exactly who needs this.
 */
export async function listChatProfiles(limit = 30): Promise<ChatProfileSearchResult[]> {
  if (!hasSupabase) return [];
  const me = await currentUserId();
  const { data, error } = await supabase
    .from('chat_profiles')
    .select('id, display_name, avatar_url, region')
    .order('display_name')
    .limit(limit);

  const direct = await hideBlocked(
    (data || [])
      .filter((row: any) => row.id !== me)
      .map((row: any) => ({
        id: row.id,
        displayName: row.display_name || 'OGN Member',
        avatarUrl: row.avatar_url || undefined,
        region: row.region || undefined,
      })),
    (person) => person.id,
  );
  if (direct.length) return direct;

  // Nothing came back. Rather than show a member an empty list and no way to
  // begin, offer the people they already share a room with — that roster is
  // always readable to someone in the room.
  const fallback = await peopleFromMyRooms(me, limit);
  if (fallback.length) return fallback;
  if (error) throw error;
  return [];
}

/** Everyone in the rooms this person is already part of, newest rooms first. */
async function peopleFromMyRooms(me: string | null, limit: number): Promise<ChatProfileSearchResult[]> {
  try {
    const rooms = await getChatRooms();
    const found = new Map<string, ChatProfileSearchResult>();
    for (const room of rooms.slice(0, 5)) {
      if (found.size >= limit) break;
      const members = await getChatMembers(room.id).catch(() => [] as ChatMember[]);
      for (const member of members) {
        if (!member.userId || member.userId === me || found.has(member.userId)) continue;
        found.set(member.userId, { id: member.userId, displayName: member.displayName, avatarUrl: member.avatarUrl });
      }
    }
    return [...found.values()].slice(0, limit);
  } catch {
    return [];
  }
}

export async function searchChatProfiles(query: string): Promise<ChatProfileSearchResult[]> {
  if (!hasSupabase) return [];
  const term = query.trim();
  if (term.length < 2) return listChatProfiles();
  const me = await currentUserId();
  const needle = `%${term}%`;
  const [byName, byPhone] = await Promise.all([
    supabase.from('chat_profiles').select('id, display_name, avatar_url, region').ilike('display_name', needle).limit(20),
    // Staff can also find somebody by their number. For a member this simply
    // comes back empty, which costs nothing and reveals nothing.
    supabase.from('profiles').select('id, display_name, phone, avatar_url').or(`display_name.ilike.${needle},phone.ilike.${needle}`).limit(20),
  ]);
  if (byName.error && byPhone.error) throw byName.error;

  const found = new Map<string, ChatProfileSearchResult>();
  for (const row of (byName.data || []) as any[]) {
    if (row.id === me) continue;
    found.set(row.id, { id: row.id, displayName: row.display_name || 'OGN Member', avatarUrl: row.avatar_url || undefined, region: row.region || undefined });
  }
  for (const row of (byPhone.data || []) as any[]) {
    if (row.id === me) continue;
    const already = found.get(row.id);
    found.set(row.id, {
      id: row.id,
      displayName: already?.displayName || row.display_name || 'OGN Member',
      avatarUrl: already?.avatarUrl || row.avatar_url || undefined,
      region: already?.region,
      phone: row.phone || undefined,
    });
  }
  if (found.size) return hideBlocked([...found.values()], (person) => person.id);

  // Same reasoning as listChatProfiles: fall back to the people already in
  // this person's rooms so a search is never a dead end.
  const needleLower = term.toLowerCase();
  const known = await peopleFromMyRooms(me, 60);
  return known.filter((person) => person.displayName.toLowerCase().includes(needleLower));
}

export async function getChatMembers(channelId: string): Promise<ChatMember[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.rpc('get_chat_member_roster', { p_channel_id: channelId });
  if (error) throw error;
  if (!data) return [];
  const profiles = await getProfilesByIds(data.map((row: any) => row.user_id).filter(Boolean));
  const members: ChatMember[] = data.map((row: any) => ({
    userId: row.user_id,
    role: row.role || 'member',
    joinedAt: row.joined_at || undefined,
    displayName: row.display_name || 'OGN Member',
    phone: profiles.get(row.user_id)?.phone,
    avatarUrl: row.avatar_url || undefined,
  }));
  // Same rule as the messages: somebody you blocked is not in your roster
  // either. A leader's roster is never filtered — that is the leader tools.
  return hideBlocked(members, (member) => member.userId);
}

export async function addChatMember(channelId: string, userId: string) {
  if (!hasSupabase) return { channel_id: channelId, user_id: userId };
  const existing = await supabase
    .from('chat_members')
    .select('channel_id, user_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const { data, error } = await supabase
    .from('chat_members')
    .insert({ channel_id: channelId, user_id: userId, role: 'member' })
    .select('channel_id, user_id')
    .single();
  if (error) throw error;
  return data;
}

export async function removeChatMember(channelId: string, userId: string) {
  if (!hasSupabase) return { channel_id: channelId, user_id: userId };
  const { error } = await supabase
    .from('chat_members')
    .delete()
    .eq('channel_id', channelId)
    .eq('user_id', userId);
  if (error) throw error;
  return { channel_id: channelId, user_id: userId };
}

async function ensureChatMember(channelId: string, userId: string) {
  const existing = await supabase
    .from('chat_members')
    .select('channel_id, user_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await supabase
    .from('chat_members')
    .insert({ channel_id: channelId, user_id: userId, role: 'member' })
    .select('channel_id, user_id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function getProfilesByIds(userIds: string[]) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  const profiles = new Map<string, { displayName: string; phone?: string; avatarUrl?: string }>();
  if (!hasSupabase || !uniqueIds.length) return profiles;
  // Names and pictures come from chat_profiles, which every signed-in person
  // may read. Phones come from profiles, which only staff may read for other
  // people; for a member that query simply returns fewer rows.
  const [names, full] = await Promise.all([
    supabase.from('chat_profiles').select('id, display_name, avatar_url').in('id', uniqueIds),
    supabase.from('profiles').select('id, phone').in('id', uniqueIds),
  ]);
  const phones = new Map((full.data || []).map((row: any) => [row.id, row.phone || undefined]));
  (names.data || []).forEach((row: any) => {
    profiles.set(row.id, {
      displayName: row.display_name || 'OGN Member',
      phone: phones.get(row.id),
      avatarUrl: row.avatar_url || undefined
    });
  });
  return profiles;
}
