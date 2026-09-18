import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatRoom } from '../types/models';
import { supabase } from './supabase';
import { FriendlyError } from './errorMessages';
import { UploadError, bucketSizeLimit, currentUserId, formatBytes, uploadFileToBucket } from './uploadService';
// uploadService re-exports only part of this module, so the shrink helpers are
// imported from where they live.
import { CONTENT_IMAGE_MAX_EDGE, isImageMime, prepareImageForUpload } from './uploadBody';

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
  kind: 'sermon' | 'music' | 'video' | 'story' | 'article' | 'scripture';
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

function normalizeRoomType(type?: string): ChatRoom['type'] {
  if (type === 'announcement' || type === 'leader' || type === 'regional' || type === 'prayer' || type === 'direct' || type === 'group' || type === 'general' || type === 'global') {
    return type;
  }
  return 'global';
}

function roomFromRow(row: any): ChatRoom {
  return {
    id: row.id,
    name: row.name,
    region: row.region || 'Worldwide',
    members: 0,
    // No read tracking exists yet, so no invented unread counts.
    unread: 0,
    type: normalizeRoomType(row.channel_type),
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
  return data.reverse().map((row: any) => ({
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
}

export async function sendChatMessage(channelId: string, body: string, attachment?: { path: string; kind: ChatAttachmentKind; name?: string; size?: number }, shared?: SharedRef) {
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
    .select('id, is_flagged')
    .single();
  if (error) throw error;
  return { id: data.id as string, isFlagged: Boolean(data.is_flagged) };
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
          Promise.all([
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
        },
      )
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

export async function moderateChatMessage(messageId: string, action: 'remove' | 'flag' = 'remove') {
  if (!hasSupabase) return { id: messageId };
  const patch = action === 'remove' ? { deleted_at: new Date().toISOString(), is_flagged: true } : { is_flagged: true };
  const { data, error } = await supabase
    .from('chat_messages')
    .update(patch)
    .eq('id', messageId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

// A member takes back their own message. Soft delete, so moderators can still see it.
export async function deleteOwnChatMessage(messageId: string) {
  if (!hasSupabase) return { id: messageId };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before removing a message.');
  const { data, error } = await supabase
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('user_id', userId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function reportChatMessage(messageId: string, reason = 'In-app report') {
  if (!hasSupabase) return { id: `local-report-${Date.now()}` };
  const userId = await currentUserId();
  if (!userId) throw new FriendlyError('Please sign in before reporting something.');
  const { data, error } = await supabase
    .from('content_reports')
    .insert({
      reporter_id: userId,
      target_type: 'chat_message',
      target_id: messageId,
      reason,
      status: 'new',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
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
  return data;
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

  const direct = (data || [])
    .filter((row: any) => row.id !== me)
    .map((row: any) => ({
      id: row.id,
      displayName: row.display_name || 'OGN Member',
      avatarUrl: row.avatar_url || undefined,
      region: row.region || undefined,
    }));
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
  if (found.size) return [...found.values()];

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
  return data.map((row: any) => ({
    userId: row.user_id,
    role: row.role || 'member',
    joinedAt: row.joined_at || undefined,
    displayName: row.display_name || 'OGN Member',
    phone: profiles.get(row.user_id)?.phone,
    avatarUrl: row.avatar_url || undefined,
  }));
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
