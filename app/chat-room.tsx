import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, AppStateStatus, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import {
  ChatAttachment,
  ChatConnectionState,
  ChatMember,
  ChatMessage,
  ChatProfileSearchResult,
  ReadCursor,
  ReplyPreview,
  SharedRef,
  addChatMember,
  createCursorThrottle,
  getChatReadCursors,
  getReplyPreview,
  messageReceipt,
  replyPreviewFor,
  saveChatReadCursor,
  subscribeToReadCursors,
  timestampMs,
  alreadyReported,
  announceChatChange,
  blockChatUser,
  blockHidesContent,
  chatAuthorIsAdmin,
  chatRoomTitle,
  clearChatGroupPicture,
  deleteChatMessageForEveryone,
  getChatMembers,
  getChatMessages,
  getChatRooms,
  hideChatMessageForMe,
  holdChatMessage,
  isUserBlocked,
  joinChatRoom,
  removeChatMember,
  reportChatMessage,
  searchChatProfiles,
  sendChatMessage,
  subscribeToChat,
  unblockChatUser,
  uploadChatAttachment,
  uploadChatGroupPicture,
} from '../lib/chatService';
import { AttachSheet, AttachmentBubble, AttachmentPreview, PhotoViewer, PickedFile } from '../components/ChatAttachments';
import {
  ChatActionSheet,
  ChatSheetAction,
  MessageBody,
  MessageInfoSheet,
  ReceiptMark,
  ReplyComposerBar,
  ReplyQuote,
  RoomBadge,
  SwipeToReply,
  formatDayLabel,
  formatMessageTime,
  initials,
  roomLabel,
} from '../components/chatShared';
import { SharedCard } from '../components/ShareToChat';
import { SongPicker } from '../components/SongPicker';
import { songSharedRef } from '../lib/songShare';
import type { MediaItem } from '../types/models';
import { VoiceNotePlaybackProvider, useVoiceNotePlayback } from '../components/VoiceNotePlayer';
import { RecordedVoiceNote, VoiceNoteRecordingBar, askForMicrophone } from '../components/VoiceNoteRecorder';
import { VOICE_NOTE_MIME, canRecordVoiceNotes, voiceNoteFileName } from '../lib/voiceNotes';
import { GIVE_SHARED, mentionsGiving } from '../lib/givingNudge';
import { playbackKind } from '../lib/embed';
import { REVIEW_NOTICE, friendlyError, mentionsSelfHarm } from '../lib/errorMessages';
import { useNowPlaying } from '../lib/nowPlaying';
import { supabase } from '../lib/supabase';
import { currentUserId, friendlyUploadError } from '../lib/uploadService';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { ChatRoom } from '../types/models';

/**
 * One room, full screen. Header with the room's name and a back arrow, the
 * newest messages at the bottom, and the message box pinned above the
 * keyboard. Leader tools live behind the shield button, in a sheet.
 *
 * Two things this screen promises. A photo appears in the thread the moment
 * you send it, with a bar that shows real bytes leaving the phone — never a
 * spinner that could mean anything. And a live connection that drops says
 * "Reconnecting" quietly and keeps the room readable; it can never take the
 * screen, or the app, down with it.
 */
type Row = { kind: 'message'; message: ChatMessage } | { kind: 'day'; id: string; label: string };

/** The newest message the server stamped — never one still leaving this phone, whose time is the phone's own clock. */
function newestServerStamp(list: ChatMessage[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const message of list) {
    if (message.sendingProgress !== undefined || message.id.startsWith('sending-')) continue;
    // A held message approved later became visible at visibleSince, and its
    // receipts count from then — so seeing it must move the mark that far too.
    for (const stamp of [message.createdAt, message.visibleSince]) {
      const ms = timestampMs(stamp);
      if (stamp && Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = stamp; }
    }
  }
  return best;
}

/**
 * One voice-note player for the whole room (components/VoiceNotePlayer.tsx),
 * so only one voice note plays at a time and none of them talks over the
 * sermon in the mini player.
 */
export default function ChatRoomScreen() {
  return (
    <VoiceNotePlaybackProvider>
      <ChatRoomView />
    </VoiceNotePlaybackProvider>
  );
}

function ChatRoomView() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const roomId = typeof params.id === 'string' ? params.id : '';
  const { access } = useAccessProfile();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const nowPlaying = useNowPlaying();
  const listRef = useRef<FlatList<Row> | null>(null);
  const composerRef = useRef<TextInput | null>(null);
  const alive = useRef(true);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  /** The church's Give card rides along with the next message when this is on. */
  const [attachGive, setAttachGive] = useState(false);
  const [giveNudgeDismissed, setGiveNudgeDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterNote, setRosterNote] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ChatConnectionState>('connecting');
  const [attachOpen, setAttachOpen] = useState(false);
  // Songs from Media, sent as a song card (owner's list, 2026-09-22).
  const [songOpen, setSongOpen] = useState(false);
  const [sendingSong, setSendingSong] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<{ userId?: string; displayName: string; phone?: string; avatarUrl?: string; role?: string } | null>(null);
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [profileResults, setProfileResults] = useState<ChatProfileSearchResult[]>([]);
  const [memberSearchNote, setMemberSearchNote] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<ChatMember[]>([]);
  /**
   * What to say to the person about their own last message being read by a
   * leader first. Never about anybody else's message, and never a reason —
   * the words that caused it are not shown back to them.
   */
  const [careNotice, setCareNotice] = useState<{ tone: 'held' | 'care' } | null>(null);
  /** The long-press menu that is open, if any. */
  const [sheet, setSheet] = useState<{ title: string; subtitle?: string; actions: ChatSheetAction[] } | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  /** The message being answered. Its quote sits above the message box, and stays while a voice note is recorded. */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** Everyone's delivered / read marks in this room, by person. */
  const [cursors, setCursors] = useState<Map<string, ReadCursor>>(() => new Map());
  /** Your own message whose "Message info" is open. */
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  /** The original a tapped quote jumped to, lit up for a moment. */
  const [flashId, setFlashId] = useState<string | null>(null);
  /** A short, calm line above the message box that goes away by itself. */
  const [notice, setNotice] = useState<string | null>(null);
  const voicePlayback = useVoiceNotePlayback();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashId]);

  /* -------------------------------------------------------------------------
   * Delivered and read
   *
   * This phone moves ONLY its own marks. "Delivered" moves whenever messages
   * reach this phone (the room loading, or one arriving live). "Read" moves
   * only while the room is actually on screen and the app is in front. Writes
   * are held to one every few seconds, plus one when you leave.
   * ----------------------------------------------------------------------- */
  const cursorWriter = useRef<ReturnType<typeof createCursorThrottle> | null>(null);
  const focusedRef = useRef(false);
  const appActiveRef = useRef<boolean>(AppState.currentState === 'active');
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (!roomId) return;
    const writer = createCursorThrottle({ write: (marks) => saveChatReadCursor(roomId, marks) });
    cursorWriter.current = writer;
    return () => {
      if (cursorWriter.current === writer) cursorWriter.current = null;
      void writer.dispose();
    };
  }, [roomId]);

  const noteSeen = useCallback((list: ChatMessage[]) => {
    const writer = cursorWriter.current;
    const newest = newestServerStamp(list);
    if (!writer || !newest) return;
    writer.noteDelivered(newest);
    if (focusedRef.current && appActiveRef.current) writer.noteRead(newest);
  }, []);

  // Every time the messages on this phone change, the marks can move.
  useEffect(() => { noteSeen(messages); }, [messages, noteSeen]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    noteSeen(messagesRef.current);
    return () => {
      focusedRef.current = false;
      void cursorWriter.current?.flush();
    };
  }, [noteSeen]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      appActiveRef.current = state === 'active';
      if (state === 'active') noteSeen(messagesRef.current);
      else void cursorWriter.current?.flush();
    });
    return () => sub.remove();
  }, [noteSeen]);

  const loadCursors = useCallback(async () => {
    if (!roomId) return;
    const list = await getChatReadCursors(roomId);
    if (alive.current) setCursors(new Map(list.map((cursor) => [cursor.userId, cursor])));
  }, [roomId]);

  // Ticks change live as people read. Its own connection: if it cannot open,
  // messages are untouched and the ticks catch up on the next refresh.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const channel = subscribeToReadCursors(roomId, (cursor) => {
      if (cancelled) return;
      setCursors((current) => {
        const next = new Map(current);
        const known = current.get(cursor.userId);
        const later = (a?: string | null, b?: string | null) => (timestampMs(b) > timestampMs(a) || !Number.isFinite(timestampMs(a)) ? b ?? a : a);
        next.set(cursor.userId, known
          ? { userId: cursor.userId, readAt: later(known.readAt, cursor.readAt), deliveredAt: later(known.deliveredAt, cursor.deliveredAt) }
          : cursor);
        return next;
      });
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId]);

  // A reply that arrived live, to a message further back than this page:
  // ask for its quote once.
  const quotesAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!roomId) return;
    const onScreen = new Set(messages.map((message) => message.id));
    for (const message of messages) {
      if (!message.parentId || message.reply || onScreen.has(message.parentId) || quotesAsked.current.has(message.id)) continue;
      if (message.sendingProgress !== undefined || message.id.startsWith('sending-')) continue;
      quotesAsked.current.add(message.id);
      const settle = (reply: ReplyPreview) => {
        if (!alive.current) return;
        setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, reply } : item)));
      };
      void getReplyPreview(roomId, message)
        .then((reply) => settle(reply || replyPreviewFor(message.parentId as string, undefined, userId)))
        // Could not ask: say so on the quote rather than "Loading" for ever.
        .catch(() => settle(replyPreviewFor(message.parentId as string, undefined, userId)));
    }
  }, [messages, roomId, userId]);

  // Who am I: read from the session already on the phone, not over the network.
  useEffect(() => {
    let cancelled = false;
    currentUserId()
      .then((id) => { if (!cancelled) setUserId(id); })
      .catch(() => { if (!cancelled) setUserId(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    getChatRooms()
      .then((rooms) => { if (!cancelled) setRoom(rooms.find((item) => item.id === roomId) || null); })
      // The room's own name came in on the route, so the header still reads
      // correctly. Nothing to tell anybody about.
      .catch(() => { if (!cancelled) setRoom(null); });
    return () => { cancelled = true; };
  }, [roomId]);

  /**
   * Messages and the member roster are loaded separately on purpose.
   *
   * They used to share one Promise.all, so a roster call that failed threw the
   * messages away with it and the room read "No messages yet" when it was full
   * of them.
   */
  const loadMessages = useCallback(async () => {
    if (!roomId) return;
    await joinChatRoom(roomId);
    const items = await getChatMessages(roomId);
    if (alive.current) {
      // Anything still uploading from this phone stays where it is.
      setMessages((current) => [...items, ...current.filter((m) => typeof m.sendingProgress === 'number')]);
    }
  }, [roomId]);

  const loadRoster = useCallback(async () => {
    if (!roomId) return;
    try {
      const members = await getChatMembers(roomId);
      if (alive.current) { setRoomMembers(members); setRosterNote(null); }
    } catch {
      // A roster we cannot read is a small thing. The conversation is not.
      if (alive.current) setRosterNote('The member list is not available right now.');
    }
  }, [roomId]);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      await loadMessages();
    } catch (err) {
      if (alive.current) setError(friendlyError(err, 'Messages did not load. Pull down to try again.'));
    } finally {
      if (alive.current) setLoading(false);
    }
    loadRoster();
    // After the join inside loadMessages: marks are only readable by members.
    void loadCursors();
  }, [loadCursors, loadMessages, loadRoster]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) loadAll(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadAll]));

  /**
   * A gentle word BEFORE the send button, not a gate.
   *
   * The database decides what is held (DO-NOT-BREAK item 18) and this changes
   * nothing about that: the send button stays enabled, the message still
   * goes, and nothing about what is typed is checked anywhere but here, on
   * this phone, to choose one sentence. See SELF_HARM_HINT in
   * lib/errorMessages.ts.
   */
  const warnBeforeSending = useMemo(() => mentionsSelfHarm(body), [body]);

  const connectionRef = useRef<ChatConnectionState>('connecting');
  useEffect(() => { connectionRef.current = connection; }, [connection]);
  /** The room's live channel, so a delete or hold can tell the other phones. */
  const liveChannel = useRef<ReturnType<typeof subscribeToChat>>(undefined);

  /**
   * One live connection, opened once for this room and closed when the room
   * closes. It only ever adds a message or reports its own health.
   */
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    // Another phone deleted or held a message: read the room again, at most
    // once every few seconds however many signals arrive.
    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = () => {
      if (cancelled || changeTimer) return;
      changeTimer = setTimeout(() => { changeTimer = null; if (!cancelled) catchUp(); }, 1500);
    };
    const channel = subscribeToChat(
      roomId,
      (message) => { if (!cancelled) setMessages((current) => [...current.filter((item) => item.id !== message.id), message]); },
      (state) => { if (!cancelled) setConnection(state); },
      onChanged,
    );
    liveChannel.current = channel;
    if (!channel) setConnection('reconnecting');

    const catchUp = () => {
      void loadCursors();
      loadMessages().catch(() => {
        // A background catch-up that fails changes nothing on screen; the
        // person still has the messages they had, and pull-to-refresh says so.
        if (!cancelled) setConnection('reconnecting');
      });
    };
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') catchUp(); });
    // Only poll when the live connection is not carrying its weight.
    const poll = setInterval(() => { if (!cancelled && connectionRef.current !== 'live') catchUp(); }, 30000);
    return () => {
      cancelled = true;
      foreground.remove();
      clearInterval(poll);
      if (changeTimer) clearTimeout(changeTimer);
      liveChannel.current = undefined;
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadCursors, loadMessages, roomId]);

  useEffect(() => {
    if (!leaderOpen || !access.canManageChatMembers) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchChatProfiles(memberQuery)
        .then((results) => { if (!cancelled) { setProfileResults(results); setMemberSearchNote(null); } })
        .catch((err) => {
          if (cancelled) return;
          setProfileResults([]);
          setMemberSearchNote(friendlyError(err, 'The people list could not be searched just now.'));
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [access.canManageChatMembers, leaderOpen, memberQuery]);

  // Newest at the bottom. The list is inverted, so the data is reversed and
  // day labels sit *after* (visually above) the first message of each day.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
    const ordered = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const message of ordered) {
      const day = formatDayLabel(message.createdAt);
      if (day && day !== lastDay) {
        out.push({ kind: 'day', id: 'day-' + message.id, label: day });
        lastDay = day;
      }
      out.push({ kind: 'message', message });
    }
    return out.reverse();
  }, [messages]);

  const title = room ? chatRoomTitle(room, access.displayName) : (typeof params.name === 'string' ? params.name : 'Chat');

  async function refreshRoom() {
    setRefreshing(true);
    setError(null);
    try {
      await loadMessages();
    } catch (err) {
      setError(friendlyError(err, 'Messages did not load. Pull down to try again.'));
    } finally {
      setRefreshing(false);
    }
    loadRoster();
    void loadCursors();
  }

  /** The quote for a reply this phone is sending, so the bubble shows it at once. */
  function replyFields(target: ChatMessage | null): Pick<ChatMessage, 'parentId' | 'reply'> {
    if (!target) return {};
    return { parentId: target.id, reply: replyPreviewFor(target.id, target, userId) };
  }

  async function post() {
    const text = body.trim();
    if (!roomId || !text || sending) return;
    setError(null);
    setSending(true);
    const answering = replyTo;
    try {
      const shared = attachGive ? GIVE_SHARED : undefined;
      // A reply carries the message it answers; everything else is the same send.
      const result = answering
        ? await sendChatMessage(roomId, text, undefined, shared, { parentMessageId: answering.id })
        : await sendChatMessage(roomId, text, undefined, shared);
      setMessages((current) => [...current.filter((item) => item.id !== result.id), {
        id: result.id, channelId: roomId, userId: userId || undefined, body: text, displayName: 'You', createdAt: result.createdAt, isFlagged: result.isFlagged, shared,
        ...replyFields(answering),
      }]);
      setBody('');
      setReplyTo(null);
      setAttachGive(false);
      setGiveNudgeDismissed(false);
      // The message stays in the thread either way, so nobody is left
      // wondering where it went. What changes is what we say about it.
      if (result.isFlagged) setCareNotice({ tone: mentionsSelfHarm(text) ? 'care' : 'held' });
    } catch (err) {
      setError(friendlyError(err, 'Message not sent. Check your connection and try again.'));
    } finally {
      setSending(false);
    }
  }

  /** Send one of the church's songs into this chat as a card anyone can play. */
  async function sendSong(song: MediaItem) {
    if (!roomId || sendingSong) return;
    setError(null);
    setSendingSong(true);
    const answering = replyTo;
    const shared = songSharedRef(song);
    try {
      const result = await sendChatMessage(roomId, '', undefined, shared, answering ? { parentMessageId: answering.id } : undefined);
      setMessages((current) => [...current.filter((item) => item.id !== result.id), {
        id: result.id, channelId: roomId, userId: userId || undefined, body: '', displayName: 'You', createdAt: result.createdAt, isFlagged: result.isFlagged, shared,
        ...replyFields(answering),
      }]);
      setReplyTo(null);
      setSongOpen(false);
    } catch (err) {
      setSongOpen(false);
      setError(friendlyError(err, 'The song was not sent. Check your connection and try again.'));
    } finally {
      setSendingSong(false);
    }
  }

  /**
   * Send a photo, a video or a file.
   *
   * The bubble appears immediately, showing the picture straight off the
   * phone, and its bar fills with real bytes as they go out.
   */
  async function sendAttachment(caption: string) {
    if (!roomId || !pendingFile || sendingFile) return;
    const file = pendingFile;
    const localId = `sending-${Date.now()}`;
    const answering = replyTo;
    setSendingFile(true);
    setPendingFile(null);
    setReplyTo(null);
    setMessages((current) => [...current, {
      id: localId,
      channelId: roomId,
      userId: userId || undefined,
      body: caption,
      displayName: 'You',
      createdAt: new Date().toISOString(),
      sendingProgress: 0,
      attachment: { path: '', url: file.uri, kind: file.kind, name: file.name || undefined, size: file.size || undefined, width: file.width, height: file.height },
      ...replyFields(answering),
    }]);

    const onProgress = (fraction: number) => {
      if (!alive.current) return;
      setMessages((current) => current.map((item) => (item.id === localId ? { ...item, sendingProgress: fraction } : item)));
    };

    try {
      await joinChatRoom(roomId);
      const uploaded = await uploadChatAttachment(roomId, file, { onProgress });
      const sent = await sendChatMessage(roomId, caption, uploaded, undefined, { parentMessageId: answering?.id });
      if (!alive.current) return;
      setMessages((current) => [...current.filter((item) => item.id !== localId && item.id !== sent.id), {
        id: sent.id, channelId: roomId, userId: userId || undefined, body: caption, displayName: 'You', createdAt: sent.createdAt, isFlagged: sent.isFlagged,
        attachment: { path: uploaded.path, url: file.uri, kind: uploaded.kind, name: uploaded.name, size: uploaded.size, width: uploaded.width, height: uploaded.height },
        ...replyFields(answering),
      }]);
      if (sent.isFlagged) setCareNotice({ tone: mentionsSelfHarm(caption) ? 'care' : 'held' });
    } catch (err) {
      if (!alive.current) return;
      setMessages((current) => current.filter((item) => item.id !== localId));
      // Keep the reply, so trying again answers the same message.
      if (answering) setReplyTo((current) => current || answering);
      setError(friendlyUploadError(err, 'That did not send. Please try again, ideally on Wi-Fi.'));
    } finally {
      if (alive.current) setSendingFile(false);
    }
  }

  /* -------------------------------------------------------------------------
   * Voice notes
   *
   * The microphone button takes the place of Send while the message box is
   * empty. A voice note goes through exactly the same private upload as a
   * photo (DO-NOT-BREAK #20): <room>/<you>/, signed links, never public.
   * ----------------------------------------------------------------------- */
  async function startVoiceNote() {
    if (recording || !roomId) return;
    const allowed = await askForMicrophone();
    if (!allowed || !alive.current) return;
    // Nothing talks over you while you record.
    voicePlayback?.pauseAll();
    if (nowPlaying.playing) nowPlaying.toggle();
    setRecording(true);
  }

  async function sendVoiceNote(note: RecordedVoiceNote) {
    setRecording(false);
    if (!roomId) return;
    const answering = replyTo;
    setReplyTo(null);
    const name = voiceNoteFileName();
    const localId = `sending-${Date.now()}`;
    setMessages((current) => [...current, {
      id: localId,
      channelId: roomId,
      userId: userId || undefined,
      body: '',
      displayName: 'You',
      createdAt: new Date().toISOString(),
      sendingProgress: 0,
      attachment: { path: '', url: note.uri, kind: 'audio', name, durationMs: note.durationMs },
      ...replyFields(answering),
    }]);
    const onProgress = (fraction: number) => {
      if (!alive.current) return;
      setMessages((current) => current.map((item) => (item.id === localId ? { ...item, sendingProgress: fraction } : item)));
    };
    try {
      await joinChatRoom(roomId);
      const uploaded = await uploadChatAttachment(roomId, { uri: note.uri, name, mimeType: VOICE_NOTE_MIME }, { onProgress });
      const sent = await sendChatMessage(roomId, '', { ...uploaded, durationMs: note.durationMs }, undefined, { parentMessageId: answering?.id });
      if (!alive.current) return;
      setMessages((current) => [...current.filter((item) => item.id !== localId && item.id !== sent.id), {
        id: sent.id, channelId: roomId, userId: userId || undefined, body: '', displayName: 'You', createdAt: sent.createdAt, isFlagged: sent.isFlagged,
        attachment: { path: uploaded.path, url: note.uri, kind: 'audio', name: uploaded.name, size: uploaded.size, durationMs: note.durationMs },
        ...replyFields(answering),
      }]);
      if (sent.isFlagged) setCareNotice({ tone: 'held' });
    } catch (err) {
      if (!alive.current) return;
      setMessages((current) => current.filter((item) => item.id !== localId));
      if (answering) setReplyTo((current) => current || answering);
      setError(friendlyUploadError(err, 'That voice note did not send. Please try again, ideally on Wi-Fi.'));
    }
  }

  /** Reply to a message: its quote goes above the message box, and the keyboard comes up. */
  function startReply(message: ChatMessage) {
    if (message.deleted || message.sendingProgress !== undefined) return;
    setReplyTo(message);
    if (!recording) setTimeout(() => composerRef.current?.focus(), 50);
  }

  /** Go to the message a quote points at, when it is loaded. */
  const rowsRef = useRef<Row[]>([]);
  function jumpTo(messageId: string) {
    const index = rowsRef.current.findIndex((row) => row.kind === 'message' && row.message.id === messageId);
    if (index < 0) {
      setNotice('That message is older than the messages shown here, so the app cannot take you to it.');
      return;
    }
    setFlashId(messageId);
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }

  async function openExternalUrl(url?: string) {
    if (!url) return;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) return Alert.alert('Link unavailable', 'This link cannot be opened on this device.');
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Unable to open link', friendlyError(err, 'Please try again.'));
    }
  }

  function openShared(shared: SharedRef) {
    if (shared.kind === 'give') return router.push('/(tabs)/give' as any);
    if (shared.kind === 'event') return shared.eventId ? router.push({ pathname: '/event-detail', params: { id: shared.eventId } } as any) : undefined;
    if (shared.kind === 'scripture' && shared.scripture) {
      const verse = shared.scripture;
      return router.push({ pathname: '/(tabs)/bible', params: { bookId: verse.bookId, chapter: String(verse.chapter), verse: String(verse.verse), version: verse.version } });
    }
    if (!shared.url) {
      return Alert.alert('Nothing to open yet', 'This card came without a link. Ask the person who shared it to share it again from Media.');
    }
    if (shared.kind === 'story') return router.push({ pathname: '/story-viewer', params: { title: shared.title, imageUrl: shared.url } });
    if (shared.kind === 'article') return openExternalUrl(shared.url);
    nowPlaying.play({ title: shared.title, speaker: shared.speaker, url: shared.url, artwork: shared.artwork, type: playbackKind(shared.url, shared.kind === 'music' ? 'audio' : 'video') });
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.kind === 'image') return setPhotoUrl(attachment.url);
    if (attachment.kind === 'video' || attachment.kind === 'audio') {
      return nowPlaying.play({ title: attachment.name || (attachment.kind === 'video' ? 'Shared video' : 'Shared audio'), speaker: title, url: attachment.url, type: attachment.kind });
    }
    openExternalUrl(attachment.url);
  }

  /** Everyone has a page. A message without a user id shows the small card. */
  function openPerson(message: ChatMessage) {
    if (message.userId) return router.push({ pathname: '/person', params: { id: message.userId, name: message.displayName } } as any);
    setSelectedProfile({ userId: message.userId, displayName: message.displayName, avatarUrl: message.avatarUrl });
  }

  /**
   * Report is a real report: it files a row in the same queue the database's
   * own filter writes to, and it says so without accusing anybody. Reporting
   * the same message twice writes nothing the second time.
   */
  async function reportMessage(message: ChatMessage) {
    try {
      const result = await reportChatMessage(message.id, 'Member report: chat message');
      Alert.alert(
        'Thank you for telling us',
        result.alreadyReported
          ? 'You have already told us about this one, and a leader has it. You do not need to do anything else.'
          : 'A leader from the ministry will read this. You do not need to do anything else.',
      );
    } catch (err) {
      Alert.alert('That report did not go through', friendlyError(err, 'Please try again.'));
    }
  }

  /**
   * Block is a real block: lib/chatService.ts reads the list back on every load
   * of every room, so the person is gone from the history, from the live
   * connection and from the member list, not just from this screen's memory.
   *
   * Nothing is sent to the person who was blocked, and nothing on their phone
   * changes. What we say here depends on what actually happened — a leader who
   * moderates the room keeps seeing the messages, and is told that plainly
   * rather than being told they are hidden when they are not.
   */
  async function blockPerson(personId: string, displayName: string) {
    try {
      await blockChatUser(personId);
      const hides = await blockHidesContent();
      if (hides) {
        setMessages((current) => current.filter((item) => item.userId !== personId));
        setRoomMembers((current) => current.filter((item) => item.userId !== personId));
      }
      Alert.alert(
        `${displayName} is blocked`,
        hides
          ? 'You will not see what they write. They are not told about this.'
          : 'Because you help look after this room you still see their messages, so you can act on them. They are not told about this.',
        [
          { text: 'Undo', onPress: () => { void unblockPerson(personId, displayName); } },
          { text: 'Done', style: 'cancel' },
        ],
      );
    } catch (err) {
      Alert.alert('That did not work', friendlyError(err, 'Please try again.'));
    }
  }

  async function unblockPerson(personId: string, displayName: string) {
    try {
      await unblockChatUser(personId);
      await refreshRoom();
      Alert.alert(`${displayName} is unblocked`, 'You will see what they write again.');
    } catch (err) {
      Alert.alert('That did not work', friendlyError(err, 'Please try again.'));
    }
  }

  /** Everyone else in the room now sees "This message was deleted". */
  function markDeleted(messageId: string) {
    setMessages((current) => current.map((item) => (item.id === messageId
      ? { ...item, deleted: true, body: '', attachment: undefined, shared: undefined, isFlagged: false }
      : item)));
  }

  function confirmDeleteForEveryone(message: ChatMessage, own: boolean) {
    Alert.alert(
      'Delete for everyone?',
      own
        ? 'Everyone in this chat will see "This message was deleted" instead of what you wrote.'
        : `Everyone in this chat will see "This message was deleted" instead of what ${message.displayName} wrote.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChatMessageForEveryone(message.id);
              markDeleted(message.id);
              void announceChatChange(liveChannel.current);
            } catch (err) {
              Alert.alert('Message not deleted', friendlyError(err, 'Please try again.'));
            }
          },
        },
      ],
    );
  }

  async function deleteForMe(message: ChatMessage) {
    try {
      await hideChatMessageForMe(message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (err) {
      Alert.alert('That did not work', friendlyError(err, 'Please try again.'));
    }
  }

  async function holdForReview(message: ChatMessage) {
    try {
      await holdChatMessage(message.id);
      setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, isFlagged: true } : item)));
      void announceChatChange(liveChannel.current);
      Alert.alert(
        'Held for review',
        `Only ${message.displayName} and the leaders can see this message now. It is waiting in Admin, under Needs your look. Approve it there to put it back.`,
      );
    } catch (err) {
      Alert.alert('Message not held', friendlyError(err, 'Please try again.'));
    }
  }

  /**
   * What a long press offers.
   *
   *   Your own message       Reply, Message info, Delete for everyone, Delete for me
   *   Somebody else's        Reply, Delete for me, Report, Block
   *   ...and for a leader    Delete for everyone and Hold for review as well,
   *                          except on an admin's message (DO-NOT-BREAK #5)
   *   A deleted message      Delete for me (to clear the line away)
   *
   * Every one of these is checked again by the database; the menu only
   * decides what is worth offering.
   */
  async function messageActions(message: ChatMessage, own: boolean) {
    if (message.sendingProgress !== undefined) return;
    const actions: ChatSheetAction[] = [];
    const forMe: ChatSheetAction = {
      key: 'hide',
      label: 'Delete for me',
      icon: 'eye-off-outline',
      hint: 'Only you stop seeing it. Everyone else still does.',
      onPress: () => { void deleteForMe(message); },
    };

    const reply: ChatSheetAction = {
      key: 'reply',
      label: 'Reply',
      icon: 'arrow-undo-outline',
      onPress: () => startReply(message),
    };

    if (message.deleted) {
      actions.push(forMe);
    } else if (own) {
      actions.push(reply);
      actions.push({
        key: 'info',
        label: 'Message info',
        icon: 'information-circle-outline',
        hint: 'Who has received it and who has read it.',
        onPress: () => setInfoFor(message),
      });
      actions.push({
        key: 'delete-all',
        label: 'Delete for everyone',
        icon: 'trash-outline',
        destructive: true,
        onPress: () => confirmDeleteForEveryone(message, true),
      });
      actions.push(forMe);
    } else {
      const personId = message.userId;
      // Asked before the sheet opens so the menu is right the first time.
      const [blocked, writerIsAdmin] = await Promise.all([
        personId ? isUserBlocked(personId) : Promise.resolve(false),
        personId && (access.canRemoveChatMessages || access.canModerateChat) ? chatAuthorIsAdmin(personId) : Promise.resolve(false),
      ]);
      // A leader may not remove or hold an admin's message. An admin may.
      const outranked = writerIsAdmin && access.level !== 'super_admin';
      actions.push(reply);
      if (access.canRemoveChatMessages && !outranked) {
        actions.push({
          key: 'delete-all',
          label: 'Delete for everyone',
          icon: 'trash-outline',
          destructive: true,
          onPress: () => confirmDeleteForEveryone(message, false),
        });
      }
      if (access.canModerateChat && !outranked && !message.isFlagged) {
        actions.push({
          key: 'hold',
          label: 'Hold for review',
          icon: 'pause-circle-outline',
          hint: 'Hidden from the room until a leader approves it.',
          onPress: () => { void holdForReview(message); },
        });
      }
      actions.push(forMe);
      actions.push({
        key: 'report',
        label: alreadyReported('chat_message', message.id) ? 'Already reported' : 'Report this message',
        icon: 'flag-outline',
        onPress: () => { void reportMessage(message); },
      });
      if (personId && !blocked) {
        actions.push({
          key: 'block',
          label: 'Block this person',
          icon: 'hand-left-outline',
          destructive: true,
          onPress: () => { void blockPerson(personId, message.displayName); },
        });
      }
      if (personId && blocked) {
        actions.push({
          key: 'unblock',
          label: 'Unblock this person',
          icon: 'person-add-outline',
          onPress: () => { void unblockPerson(personId, message.displayName); },
        });
      }
    }

    setSheet({
      title: message.deleted ? 'Deleted message' : own ? 'Your message' : message.displayName,
      subtitle: message.deleted ? undefined : message.body ? message.body.slice(0, 140) : undefined,
      actions,
    });
  }

  /** The room's creator and the leaders may change a group's picture. */
  const canManageRoom = Boolean(
    room && room.type !== 'direct' && (access.canModerateChat || (userId && room.createdBy === userId)),
  );

  async function changeGroupPicture() {
    if (!room || pictureBusy) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      allowsMultipleSelection: false,
      aspect: [1, 1],
      quality: 0.86,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPictureBusy(true);
    try {
      const url = await uploadChatGroupPicture(room.id, {
        uri: asset.uri,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
      });
      setRoom((current) => (current ? { ...current, avatarUrl: url } : current));
    } catch (err) {
      Alert.alert('The picture did not change', friendlyUploadError(err, 'Please choose another picture and try again.'));
    } finally {
      setPictureBusy(false);
    }
  }

  function removeGroupPicture() {
    if (!room || pictureBusy) return;
    Alert.alert('Remove the group picture?', 'The group goes back to its plain badge. You can add a new picture any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPictureBusy(true);
          try {
            await clearChatGroupPicture(room.id);
            setRoom((current) => (current ? { ...current, avatarUrl: undefined } : current));
          } catch (err) {
            Alert.alert('The picture was not removed', friendlyError(err, 'Please try again.'));
          } finally {
            setPictureBusy(false);
          }
        },
      },
    ]);
  }

  async function updateRoomMember(action: 'add' | 'remove', overrideUserId?: string) {
    const memberId = (overrideUserId || memberUserId).trim();
    if (!roomId || !memberId) return Alert.alert('Pick a person', 'Search by name or phone, then tap the person.');
    try {
      if (action === 'add') await addChatMember(roomId, memberId);
      else await removeChatMember(roomId, memberId);
      await loadRoster();
      setMemberUserId('');
      setMemberQuery('');
      setProfileResults([]);
    } catch (err) {
      Alert.alert('Member update failed', friendlyError(err, 'Check leader permissions and try again.'));
    }
  }

  const isDirect = room?.type === 'direct';
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  // People who left do not count; while the roster is unknown, everybody with a mark does.
  const memberIds = useMemo(() => (roomMembers.length ? roomMembers.map((member) => member.userId) : null), [roomMembers]);
  /** Your newest message says its status in words; older ones show just the ticks. */
  const newestOwnId = useMemo(() => {
    let best: ChatMessage | null = null;
    for (const message of messages) {
      if (!userId || message.userId !== userId || message.deleted || message.sendingProgress !== undefined) continue;
      if (!best || timestampMs(message.createdAt) > timestampMs(best.createdAt)) best = message;
    }
    return best?.id ?? null;
  }, [messages, userId]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const infoPeople = useMemo(
    () => new Map(roomMembers.map((member) => [member.userId, { displayName: member.displayName, avatarUrl: member.avatarUrl }])),
    [roomMembers],
  );
  const infoReceipt = useMemo(
    () => (infoFor ? messageReceipt({ message: infoFor, cursors: cursors.values(), memberIds }) : null),
    [cursors, infoFor, memberIds],
  );

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.dayRow}>
          <Text style={styles.dayLabel}>{item.label}</Text>
        </View>
      );
    }
    const message = item.message;
    const own = Boolean((userId && message.userId === userId) || message.sendingProgress !== undefined);
    if (message.deleted) {
      return (
        <View style={[styles.messageRow, own && styles.messageRowOwn]}>
          {!own ? <View style={styles.avatarSpacer} /> : null}
          <Pressable
            onLongPress={() => { void messageActions(message, own); }}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityLabel={`${own ? 'You' : message.displayName} deleted this message. Hold for options.`}
            accessibilityActions={[{ name: 'longpress', label: 'Options' }]}
            onAccessibilityAction={() => { void messageActions(message, own); }}
            style={styles.deletedBubble}
          >
            <Ionicons name="ban-outline" size={15} color={theme.colors.textSecondary} />
            <Text style={styles.deletedText}>{own ? 'You deleted this message' : 'This message was deleted'}</Text>
            <Text style={styles.time}>{formatMessageTime(message.createdAt)}</Text>
          </Pressable>
        </View>
      );
    }
    // What the quote says: the original itself when it is on screen (so a quote
    // follows a delete), otherwise what the service worked out.
    const parent = message.parentId ? messagesById.get(message.parentId) : undefined;
    const quote: ReplyPreview | undefined = message.parentId
      ? (parent ? replyPreviewFor(message.parentId, parent, userId) : message.reply)
      : undefined;
    const receipt = own
      ? messageReceipt({ message, cursors: cursors.values(), memberIds })
      : null;
    const sending = message.sendingProgress !== undefined;
    const a11yActions = [
      { name: 'longpress', label: 'Message options' },
      ...(!sending ? [{ name: 'reply', label: 'Reply' }] : []),
      ...(own && !sending ? [{ name: 'info', label: 'Message info' }] : []),
    ];
    return (
      <SwipeToReply enabled={!sending} dark={dark} onReply={() => startReply(message)}>
      <View style={[styles.messageRow, own && styles.messageRowOwn]}>
        {!own ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${message.displayName} profile`}
            onPress={() => openPerson(message)}
            hitSlop={8}
            style={styles.messageAvatar}
          >
            {message.avatarUrl
              ? <Image source={{ uri: message.avatarUrl }} accessibilityLabel={`${message.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
              : <Text style={styles.avatarInitial}>{initials(message.displayName)}</Text>}
          </Pressable>
        ) : null}
        <Pressable
          onLongPress={() => { void messageActions(message, own); }}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`${own ? 'Your' : message.displayName + "'s"} message.${message.isFlagged && own ? ' Only you can see this. It is waiting for an admin to review it.' : message.isFlagged ? ' Held for review.' : ''} Hold for options.`}
          accessibilityActions={a11yActions}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === 'reply') return startReply(message);
            if (action === 'info') return setInfoFor(message);
            void messageActions(message, own);
          }}
          accessibilityState={{ selected: flashId === message.id }}
          style={[styles.bubble, own && styles.bubbleOwn, flashId === message.id && styles.bubbleFlash]}
        >
          {!own ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${message.displayName} profile`} onPress={() => openPerson(message)} hitSlop={12} style={styles.senderNameWrap}>
              <Text style={styles.senderName}>{message.displayName}</Text>
            </Pressable>
          ) : null}
          {quote ? (
            <ReplyQuote reply={quote} own={own} dark={dark} onPress={() => jumpTo(quote.id)} />
          ) : message.parentId ? (
            <ReplyQuote reply={{ id: message.parentId, authorName: '', snippet: 'Loading the original…', available: false, kind: 'unavailable' }} own={own} dark={dark} />
          ) : null}
          {message.shared ? <SharedCard shared={message.shared} dark={dark} own={own} onOpen={openShared} /> : null}
          {message.attachment ? (
            <AttachmentBubble attachment={message.attachment} dark={dark} own={own} sendingProgress={message.sendingProgress} onOpen={openAttachment} />
          ) : null}
          {message.body ? <MessageBody message={message.body} dark={dark} own={own} onOpenUrl={openExternalUrl} /> : null}
          {/*
            DO-NOT-BREAK #18: a held message is visible only to its writer and
            the leaders. The writer is told exactly that, in plain words, on
            the message itself — not in a banner that scrolls away.
          */}
          {message.isFlagged ? (
            <View style={styles.heldNote}>
              <Ionicons name={own ? 'eye-outline' : 'pause-circle-outline'} size={14} color={theme.colors.accent} />
              <Text style={styles.heldText}>
                {own ? 'Only you can see this. It is waiting for an admin to review it.' : 'Held for review. Only the sender and leaders can see this.'}
              </Text>
            </View>
          ) : null}
          <View style={styles.bubbleFoot}>
            <Text style={[styles.time, own && styles.timeOwn]}>
              {message.sendingProgress !== undefined ? 'Sending…' : formatMessageTime(message.createdAt)}
            </Text>
            {receipt ? (
              <ReceiptMark
                receipt={receipt}
                isDirect={isDirect}
                dark={dark}
                showWords={message.id === newestOwnId}
                onPress={receipt.state === 'sending' ? undefined : () => setInfoFor(message)}
              />
            ) : null}
          </View>
        </Pressable>
      </View>
      </SwipeToReply>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dark, styles, theme, access.canRemoveChatMessages, access.canModerateChat, access.level, cursors, memberIds, isDirect, messagesById, newestOwnId, flashId, recording]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community' as any))} style={styles.headerButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.accent} />
          </Pressable>
          <RoomBadge room={{ type: room?.type || 'general', avatarUrl: room?.avatarUrl, name: title }} size={40} dark={dark} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. Open group information and members.`}
            onPress={() => { setMembersOpen(true); loadRoster(); }}
            style={styles.headerTitleWrap}
          >
            <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.headerSub}>
              {room
                ? room.type === 'direct'
                  ? roomLabel(room.type)
                  : `${roomLabel(room.type)} • ${room.region || 'Global'} • ${roomMembers.length} ${roomMembers.length === 1 ? 'member' : 'members'}`
                : ' '}
            </Text>
          </Pressable>
          {access.canManageChatMembers ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Leader tools" onPress={() => setLeaderOpen(true)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.accent} />
            </Pressable>
          ) : null}
        </View>

        {connection === 'reconnecting' ? (
          <View style={styles.connectionBar}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.connectionText}>Reconnecting. You can still read and send.</Text>
          </View>
        ) : null}

        <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <FlatList
            ref={listRef}
            data={rows}
            inverted
            refreshing={refreshing}
            onRefresh={refreshRoom}
            keyExtractor={(item) => (item.kind === 'day' ? item.id : item.message.id)}
            renderItem={renderRow}
            extraData={renderRow}
            onScrollToIndexFailed={(info) => {
              // The row has not been measured yet: get close, then land on it.
              listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: true });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 300);
            }}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                {loading ? (
                  <>
                    <ActivityIndicator color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>Loading messages…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="chatbubbles-outline" size={30} color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>No messages yet</Text>
                    <Text style={styles.emptyBody}>Say hello. Everyone in {title} will see it.</Text>
                  </>
                )}
              </View>
            }
          />

          {selectedProfile ? (
            <View style={styles.profilePeek}>
              <View style={styles.messageAvatar}>
                {selectedProfile.avatarUrl
                  ? <Image source={{ uri: selectedProfile.avatarUrl }} accessibilityLabel={`${selectedProfile.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
                  : <Text style={styles.avatarInitial}>{initials(selectedProfile.displayName)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profilePeekName}>{selectedProfile.displayName}</Text>
                <Text style={styles.profilePeekMeta}>{selectedProfile.role || 'Member'}{selectedProfile.phone ? ` • ${selectedProfile.phone}` : ''}</Text>
              </View>
              {selectedProfile.phone ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Call ${selectedProfile.displayName}`} onPress={() => openExternalUrl(`tel:${selectedProfile.phone?.replace(/[^\d+]/g, '')}`)} style={styles.peekButton}>
                  <Ionicons name="call-outline" size={17} color={theme.colors.accent} />
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Close this preview" onPress={() => setSelectedProfile(null)} style={styles.peekButton}>
                <Ionicons name="close" size={17} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
          ) : null}

          {rosterNote && membersOpen ? <Text style={styles.note}>{rosterNote}</Text> : null}
          {error ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={refreshRoom} style={styles.errorBar}>
              <Ionicons name="refresh" size={16} color={theme.colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </Pressable>
          ) : null}

          {/*
            What the app says once the database has held somebody's own
            message. It never names a word, never says blocked or flagged,
            and when it reads like somebody is in trouble it answers as a
            church rather than as a moderation queue.
          */}
          {careNotice ? (
            <View
              style={[styles.careCard, careNotice.tone === 'care' && styles.careCardWarm]}
              accessibilityLiveRegion="polite"
            >
              <View style={styles.careHead}>
                <Ionicons
                  name={careNotice.tone === 'care' ? 'heart' : 'time-outline'}
                  size={18}
                  color={theme.colors.accent}
                />
                <Text style={styles.careTitle}>
                  {careNotice.tone === 'care' ? REVIEW_NOTICE.careTitle : REVIEW_NOTICE.chatHeldTitle}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close this note"
                  onPress={() => setCareNotice(null)}
                  hitSlop={14}
                  style={styles.careClose}
                >
                  <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.careBody}>
                {careNotice.tone === 'care' ? REVIEW_NOTICE.careBody : REVIEW_NOTICE.chatHeldBody}
              </Text>
              {careNotice.tone === 'care' ? <Text style={styles.careUrgent}>{REVIEW_NOTICE.careUrgent}</Text> : null}
              {careNotice.tone === 'care' ? (
                <View style={styles.careActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={REVIEW_NOTICE.careReachOut}
                    onPress={() => router.push('/support' as any)}
                    style={styles.careButton}
                  >
                    <Ionicons name="headset-outline" size={16} color={theme.colors.textOnAccent} />
                    <Text style={styles.careButtonText}>{REVIEW_NOTICE.careReachOut}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={REVIEW_NOTICE.carePrayer}
                    onPress={() => router.push('/prayer' as any)}
                    style={styles.careButtonQuiet}
                  >
                    <Ionicons name="hand-left-outline" size={16} color={theme.colors.textPrimary} />
                    <Text style={styles.careButtonQuietText}>{REVIEW_NOTICE.carePrayer}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {warnBeforeSending && !careNotice ? (
            <View style={styles.sendHint} accessibilityLiveRegion="polite">
              <Ionicons name="heart-outline" size={15} color={theme.colors.accent} />
              <Text style={styles.sendHintText}>{REVIEW_NOTICE.beforeSendChat}</Text>
            </View>
          ) : null}

          {attachGive ? (
            <View style={styles.giveAttached}>
              <Ionicons name="heart" size={15} color={theme.colors.accent} />
              <Text style={styles.giveAttachedText}>The church's Give card will go with this message.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Remove the Give card" hitSlop={12} onPress={() => setAttachGive(false)} style={styles.giveNudgeClose}>
                <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          ) : !giveNudgeDismissed && mentionsGiving(body) ? (
            <View style={styles.giveNudge}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add the church's Give link to this message"
                accessibilityHint="Members can tap it to open the Give tab"
                onPress={() => setAttachGive(true)}
                hitSlop={8}
                style={styles.giveNudgeMain}
              >
                <Ionicons name="heart-outline" size={16} color={theme.colors.accent} />
                <Text style={styles.giveNudgeText}>Add the church's Give link</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Not now" hitSlop={12} onPress={() => setGiveNudgeDismissed(true)} style={styles.giveNudgeClose}>
                <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {notice ? (
            <View style={styles.noticeBar} accessibilityLiveRegion="polite">
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.accent} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          {replyTo ? (
            <ReplyComposerBar
              reply={replyPreviewFor(replyTo.id, messagesById.get(replyTo.id) || replyTo, userId)}
              dark={dark}
              onClose={() => setReplyTo(null)}
            />
          ) : null}

          <SafeAreaView edges={['bottom']} style={styles.composerWrap}>
            {recording ? (
              <VoiceNoteRecordingBar
                dark={dark}
                onCancel={() => setRecording(false)}
                onSend={(note) => { void sendVoiceNote(note); }}
                onProblem={(words) => { setRecording(false); setNotice(words); }}
              />
            ) : (
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add a photo, video, file or song" disabled={sendingFile} onPress={() => setAttachOpen(true)} style={styles.attachButton}>
                <Ionicons name="add" size={24} color={theme.colors.accent} />
              </Pressable>
              <TextInput
                ref={composerRef}
                value={body}
                onChangeText={setBody}
                placeholder={replyTo ? 'Write your reply' : `Message ${title}`}
                placeholderTextColor={theme.colors.textMuted}
                style={styles.composerInput}
                multiline
                accessibilityLabel={replyTo ? `Write a reply to ${replyTo.displayName}` : `Write a message to ${title}`}
              />
              {!body.trim() && !sending && canRecordVoiceNotes() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={replyTo ? 'Record a voice note reply' : 'Record a voice note'}
                  accessibilityHint="Up to five minutes. You can listen back before you send it."
                  onPress={() => { void startVoiceNote(); }}
                  style={styles.sendButton}
                >
                  <Ionicons name="mic" size={22} color={theme.colors.textOnBrand} />
                </Pressable>
              ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send this message"
                onPress={post}
                disabled={!body.trim() || sending}
                style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonIdle]}
              >
                {sending ? <ActivityIndicator color={theme.colors.textOnBrand} /> : <Ionicons name="send" size={18} color={theme.colors.textOnBrand} />}
              </Pressable>
              )}
            </View>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AttachSheet visible={attachOpen} dark={dark} onClose={() => setAttachOpen(false)} onPicked={setPendingFile} onSong={() => setSongOpen(true)} />
      <SongPicker visible={songOpen} dark={dark} sending={sendingSong} onClose={() => setSongOpen(false)} onChoose={(song) => { void sendSong(song); }} />
      <AttachmentPreview
        file={pendingFile}
        dark={dark}
        sending={sendingFile}
        onCancel={() => { if (!sendingFile) setPendingFile(null); }}
        onSend={sendAttachment}
      />
      <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />
      <MessageInfoSheet
        visible={Boolean(infoFor)}
        dark={dark}
        onClose={() => setInfoFor(null)}
        receipt={infoReceipt}
        isDirect={isDirect}
        people={infoPeople}
        preview={infoFor ? replyPreviewFor(infoFor.id, infoFor, userId).snippet : undefined}
      />
      <ChatActionSheet
        visible={Boolean(sheet)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        actions={sheet?.actions || []}
        dark={dark}
        onClose={() => setSheet(null)}
      />

      <Modal visible={membersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMembersOpen(false)}>
        <SafeAreaView style={[styles.sheet, styles.root]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close group information" onPress={() => setMembersOpen(false)} style={styles.headerButton}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          {room && room.type !== 'direct' ? (
            <View style={styles.groupHead}>
              <RoomBadge room={{ type: room.type, avatarUrl: room.avatarUrl, name: title }} size={88} dark={dark} />
              {room.description ? <Text style={styles.groupDescription}>{room.description}</Text> : null}
              {canManageRoom ? (
                <View style={styles.groupPictureActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={room.avatarUrl ? 'Change the group picture' : 'Add a group picture'}
                    disabled={pictureBusy}
                    onPress={() => { void changeGroupPicture(); }}
                    style={[styles.groupPictureButton, pictureBusy && styles.sendButtonIdle]}
                  >
                    {pictureBusy ? <ActivityIndicator color={theme.colors.textOnBrand} /> : <Ionicons name="camera-outline" size={17} color={theme.colors.textOnBrand} />}
                    <Text style={styles.groupPictureButtonText}>{pictureBusy ? 'Saving…' : room.avatarUrl ? 'Change picture' : 'Add a picture'}</Text>
                  </Pressable>
                  {room.avatarUrl && !pictureBusy ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove the group picture" onPress={removeGroupPicture} style={styles.groupPictureQuiet}>
                      <Text style={styles.groupPictureQuietText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.sheetSub}>{roomMembers.length} {roomMembers.length === 1 ? 'member' : 'members'} • Share encouragement, scripture, photos and videos.</Text>
          <FlatList
            data={roomMembers}
            keyExtractor={(member) => member.userId}
            refreshing={refreshing}
            onRefresh={refreshRoom}
            ListEmptyComponent={<Text style={styles.sheetSub}>{refreshing ? 'Loading members…' : rosterNote || 'No members to show yet.'}</Text>}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.displayName} profile`} style={styles.memberRow} onPress={() => { setMembersOpen(false); router.push({ pathname: '/person', params: { id: item.userId, name: item.displayName } }); }}>
                <View style={styles.messageAvatar}>
                  {item.avatarUrl
                    ? <Image source={{ uri: item.avatarUrl }} accessibilityLabel={`${item.displayName}'s picture`} style={styles.avatarImage} />
                    : <Text style={styles.avatarInitial}>{initials(item.displayName)}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profilePeekName}>{item.displayName}{item.userId === userId ? ' (you)' : ''}</Text>
                  <Text style={styles.profilePeekMeta}>{item.role || 'Member'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={leaderOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLeaderOpen(false)}>
        <KeyboardAvoidingView style={[styles.sheet, styles.root]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheetHeader}>
            <Ionicons name="shield-checkmark" size={22} color={theme.colors.accent} />
            <Text style={styles.sheetTitle}>Leader tools</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close leader tools" onPress={() => setLeaderOpen(false)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>Add people to {title}, remove them, and reach them by phone.</Text>
          <TextInput
            value={memberQuery}
            onChangeText={(text) => { setMemberQuery(text); setMemberUserId(''); }}
            placeholder="Search a name or phone"
            accessibilityLabel="Search for a person by name or phone"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.memberInput}
            autoCapitalize="none"
          />
          <FlatList
            data={memberQuery.trim() ? profileResults : roomMembers.map((member) => ({ id: member.userId, displayName: member.displayName, phone: member.phone, avatarUrl: member.avatarUrl, role: member.role, enrolled: true }))}
            keyExtractor={(item: any) => item.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={<Text style={styles.listLabel}>{memberQuery.trim() ? 'Search results' : `In this room (${roomMembers.length})`}</Text>}
            ListEmptyComponent={<Text style={styles.emptyBodyPadded}>{memberSearchNote || (memberQuery.trim() ? 'Nobody matches yet.' : 'No enrolled people visible yet.')}</Text>}
            renderItem={({ item }: { item: any }) => (
              <View style={styles.memberRow}>
                <View style={styles.messageAvatar}>
                  {item.avatarUrl
                    ? <Image source={{ uri: item.avatarUrl }} accessibilityLabel={`${item.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
                    : <Text style={styles.avatarInitial}>{initials(item.displayName)}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.profilePeekName}>{item.displayName}</Text>
                  <Text numberOfLines={1} style={styles.profilePeekMeta}>{item.phone || 'No phone on profile'}{item.role ? ` • ${item.role}` : ''}</Text>
                </View>
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${item.displayName}`} onPress={() => openExternalUrl(`tel:${String(item.phone).replace(/[^\d+]/g, '')}`)} style={styles.peekButton}>
                    <Ionicons name="call-outline" size={16} color={theme.colors.accent} />
                  </Pressable>
                ) : null}
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Message ${item.displayName} on WhatsApp`} onPress={() => openExternalUrl(`https://wa.me/${String(item.phone).replace(/[^\d]/g, '')}`)} style={styles.peekButton}>
                    <Ionicons name="logo-whatsapp" size={16} color={theme.colors.success} />
                  </Pressable>
                ) : null}
                {item.enrolled ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.displayName} from this room`} onPress={() => updateRoomMember('remove', item.id)} style={[styles.peekButton, styles.peekButtonDanger]}>
                    <Ionicons name="person-remove-outline" size={16} color={theme.colors.danger} />
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.displayName} to this room`} onPress={() => updateRoomMember('add', item.id)} style={[styles.peekButton, styles.peekButtonAdd]}>
                    <Ionicons name="person-add-outline" size={16} color={theme.colors.textOnBrand} />
                  </Pressable>
                )}
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.page },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: t.colors.navBar, borderBottomWidth: 1, borderBottomColor: t.colors.navBorder },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  headerAvatarGold: { backgroundColor: t.colors.accentSolid },
  headerTitleWrap: { flex: 1, minHeight: 48, justifyContent: 'center' },
  headerTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  headerSub: { color: t.colors.textSecondary, fontSize: t.type.overline, marginTop: 1 },
  connectionBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: t.colors.warningMuted },
  connectionText: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta },
  body: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayLabel: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.surface },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  messageRowOwn: { justifyContent: 'flex-end', paddingLeft: 48 },
  messageAvatar: { width: 36, minHeight: 36, aspectRatio: 1, borderRadius: 18, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: t.colors.accentBorder },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.overline },
  bubble: { maxWidth: '82%', minWidth: 72, minHeight: 48, borderRadius: t.radius.lg, borderBottomLeftRadius: 4, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, paddingVertical: 9, ...t.elevation.low },
  // Dark keeps the gold-tinted bubble the owner already likes; light gets the
  // navy one, which is the only fill white text reads on over a cream page.
  bubbleOwn: { borderBottomLeftRadius: t.radius.lg, borderBottomRightRadius: 4, backgroundColor: t.dark ? t.colors.accentMuted : t.colors.brandSolid, borderColor: t.colors.accentBorder },
  senderNameWrap: { minHeight: 24, justifyContent: 'center' },
  senderName: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline, marginBottom: 2 },
  // Wraps so "10:42 AM" plus "Waiting for review" never clips at large text.
  bubbleFoot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: 8, rowGap: 2, marginTop: 4 },
  time: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '700' },
  timeOwn: { color: t.dark ? t.colors.textMuted : t.colors.textOnBrand, opacity: t.dark ? 1 : 0.8 },
  // Its own small card, so the words read the same on a navy, gold or white
  // bubble in either theme.
  heldNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder,
  },
  heldText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, fontWeight: '700', lineHeight: 18 },
  avatarSpacer: { width: 36 },
  deletedBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, minWidth: 160, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: t.radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.borderStrong, backgroundColor: t.colors.surface,
  },
  deletedText: { color: t.colors.textSecondary, fontStyle: 'italic', fontSize: t.type.meta, fontWeight: '600' },
  groupHead: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  groupDescription: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, textAlign: 'center' },
  groupPictureActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupPictureButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: t.radius.pill, backgroundColor: t.colors.brandSolid },
  groupPictureButtonText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.meta },
  groupPictureQuiet: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.borderStrong },
  groupPictureQuietText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6, transform: [{ scaleY: -1 }] },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, marginTop: 8 },
  emptyBody: { color: t.colors.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 20, fontSize: t.type.body },
  emptyBodyPadded: { color: t.colors.textSecondary, textAlign: 'center', padding: 16, lineHeight: 20, fontSize: t.type.body },
  profilePeek: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder },
  profilePeekName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  profilePeekMeta: { color: t.colors.textSecondary, fontSize: t.type.overline, marginTop: 1 },
  peekButton: { width: 48, minHeight: 48, aspectRatio: 1, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  peekButtonDanger: { backgroundColor: t.colors.dangerMuted },
  peekButtonAdd: { backgroundColor: t.colors.brandSolid },
  note: { color: t.colors.textMuted, fontSize: t.type.meta, marginHorizontal: 16, marginBottom: 6 },
  errorBar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, minHeight: 48, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, borderRadius: t.radius.md, backgroundColor: t.colors.dangerMuted },
  error: { flex: 1, color: t.colors.danger, fontWeight: '700', fontSize: t.type.meta, lineHeight: 19 },
  careCard: {
    alignSelf: 'stretch',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 12,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    ...t.elevation.low,
  },
  careCardWarm: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accent },
  careHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  careTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  careClose: { width: 32, minHeight: 32, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  careBody: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20 },
  careUrgent: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta, lineHeight: 20 },
  careActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  careButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
  },
  careButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.meta },
  careButtonQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  careButtonQuietText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  sendHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.accentMuted,
  },
  sendHintText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },
  giveNudge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 12, marginBottom: 6, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted },
  giveNudgeMain: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, minWidth: 48, paddingLeft: 14, paddingRight: 6, flexShrink: 1 },
  giveNudgeText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta, flexShrink: 1 },
  giveNudgeClose: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  giveAttached: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 6, paddingLeft: 12, borderRadius: t.radius.md, backgroundColor: t.colors.accentMuted },
  giveAttachedText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },
  composerWrap: { backgroundColor: t.colors.navBar, borderTopWidth: 1, borderTopColor: t.colors.navBorder },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attachButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  composerInput: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, borderWidth: 1, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: t.type.body },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  // A quote that was tapped lights up its original for a moment.
  bubbleFlash: { borderColor: t.colors.accentSolid, borderWidth: 2 },
  noticeBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: t.radius.md, backgroundColor: t.colors.accentMuted },
  noticeText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 19 },
  sendButtonIdle: { opacity: 0.45 },
  sheet: { flex: 1, paddingTop: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 },
  sheetTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  sheetSub: { color: t.colors.textSecondary, paddingHorizontal: 16, marginTop: 2, marginBottom: 10, lineHeight: 19, fontSize: t.type.meta },
  memberInput: { marginHorizontal: 16, minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, paddingHorizontal: 14, fontSize: t.type.body },
  listLabel: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  memberRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.colors.border },
}));
