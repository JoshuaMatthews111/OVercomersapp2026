// Photos and short clips on a street-evangelism record.
//
// The owner's words, TestFlight 36: "For the street evangelism we should add a
// feature to add a photo or video (for event details)."
//
// Three pieces:
//   * useOutreachMediaDraft — the hook a FORM uses. A photo starts uploading
//     the moment it is picked, and the person carries on typing; the rows are
//     written when the record they belong to gets an id. Nothing typed is ever
//     lost to an upload that failed, and an abandoned upload is taken back out
//     of the bucket.
//   * OutreachMediaField — what that looks like: the two buttons, the honest
//     sentence about clip length, real progress, a thumbnail each, and a
//     refusal you can retry or drop.
//   * OutreachMediaStrip — the thumbnails on a record that is already saved,
//     with tap to view and Remove for whoever added it.
//
// Everything here reads a PRIVATE bucket through signed links (DO-NOT-BREAK
// #20) and is only ever drawn on screens the outreach roles can open (#1, #2).
// The viewer is a pop-up painted with theme.colors.sheet, which is opaque in
// both themes (#43). A clip is played by a plain expo-video player with no
// background flags, so nothing here touches the one NowPlaying player or its
// audio mode (#36).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  attachOutreachMedia,
  canRemoveMedia,
  describeMedia,
  discardOutreachUpload,
  durationLabel,
  friendlyAttachError,
  friendlyRemoveError,
  OUTREACH_VIDEO_GUIDANCE,
  OUTREACH_VIDEO_MAX_SECONDS,
  outreachMediaKind,
  refuseOutreachFile,
  removeOutreachMedia,
  uploadOutreachFile,
  type OutreachMediaItem,
  type OutreachMediaKind,
  type OutreachSubjectType,
  type StagedOutreachFile,
} from '../lib/outreachMedia';
import { friendlyUploadError } from '../lib/uploadService';
import { type AppTheme, createThemedStyles } from '../lib/theme';

/**
 * Say one thing to the person, on every build.
 *
 * INTEGRATION GATE, 2026-09-23. react-native-web ships
 * `class Alert { static alert() {} }`, so a plain Alert.alert says NOTHING in
 * a browser. `confirmRemove` below already knew that and asks its question
 * with window.confirm — but the two answers that come back AFTER the person
 * says Remove were still plain Alert.alert, and `OutreachMediaStrip` is drawn
 * on the web map (app/maps.tsx). So on a computer a removal that the database
 * refused looked exactly like one that worked: the picture stayed on the
 * record and nothing was said. That is the trap DO-NOT-BREAK #50 names in its
 * own words — "every refusal must also REACH the person" — and the shape of
 * the answer is the one components/ChatAttachments.tsx already uses.
 *
 * The phone path is untouched: exactly the Alert that shipped.
 */
function say(title: string, body: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${title}\n\n${body}`);
    return;
  }
  Alert.alert(title, body);
}

// ─────────────────────────────────────────────────────────────────────────────
// The draft: files chosen for a record that is still being written
// ─────────────────────────────────────────────────────────────────────────────

export type DraftMedia = {
  /** Local only; the row has its own id once it is saved. */
  key: string;
  kind: OutreachMediaKind;
  /** The file on the phone, for the thumbnail before the upload finishes. */
  localUri: string;
  sizeBytes?: number;
  durationMs?: number;
  status: 'uploading' | 'ready' | 'failed';
  /** 0 to 1, real bytes on the wire. */
  progress: number;
  /** Set once it is in the bucket. */
  staged?: StagedOutreachFile;
  /** Set when it failed, already written for a person to read. */
  error?: string;
  /** Kept so Try again does not make them find the photo a second time. */
  asset?: ImagePicker.ImagePickerAsset;
};

export type OutreachMediaDraft = ReturnType<typeof useOutreachMediaDraft>;

/**
 * Pick, upload and hold files for a record that does not exist yet.
 *
 * `userId` is who is filing them and `territoryId` is the region the record
 * will be in: together they are the folder in the bucket, which the database
 * checks the row against.
 */
export function useOutreachMediaDraft(options: {
  userId: string | null | undefined;
  territoryId: string | null | undefined;
  subjectType: OutreachSubjectType;
}) {
  const [items, setItems] = useState<DraftMedia[]>([]);
  // What is on screen, readable outside a render. React may call a state
  // updater twice, so nothing that starts an upload may live inside one.
  const itemsRef = useRef<DraftMedia[]>([]);
  itemsRef.current = items;
  const aborts = useRef(new Map<string, AbortController>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const patch = useCallback((key: string, change: Partial<DraftMedia>) => {
    if (!live.current) return;
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }, []);

  const send = useCallback(async (entry: DraftMedia) => {
    const asset = entry.asset;
    if (!asset || !options.userId) return;
    const controller = new AbortController();
    aborts.current.set(entry.key, controller);
    patch(entry.key, { status: 'uploading', progress: 0, error: undefined });
    try {
      const staged = await uploadOutreachFile({
        asset,
        userId: options.userId,
        territoryId: options.territoryId,
        kind: entry.kind,
        signal: controller.signal,
        onProgress: (fraction) => patch(entry.key, { progress: fraction }),
      });
      patch(entry.key, { status: 'ready', progress: 1, staged, error: undefined });
    } catch (error) {
      patch(entry.key, { status: 'failed', error: friendlyUploadError(error, 'That file did not go up. Your notes are safe — try again.') });
    } finally {
      aborts.current.delete(entry.key);
    }
  }, [options.userId, options.territoryId, patch]);

  /** One picked file. Refused here, before anything is sent, when it cannot fit. */
  const add = useCallback((asset: ImagePicker.ImagePickerAsset): string | null => {
    const kind = outreachMediaKind(asset.mimeType, asset.fileName);
    const refusal = refuseOutreachFile({ kind, sizeBytes: asset.fileSize, durationMs: asset.duration });
    if (refusal) return refusal;
    if (!options.userId) return 'Please sign in again before adding a photo.';
    const entry: DraftMedia = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: kind as OutreachMediaKind,
      localUri: asset.uri,
      sizeBytes: asset.fileSize ?? undefined,
      durationMs: typeof asset.duration === 'number' ? asset.duration : undefined,
      status: 'uploading',
      progress: 0,
      asset,
    };
    setItems((current) => [...current, entry]);
    void send(entry);
    return null;
  }, [options.userId, send]);

  const retry = useCallback((key: string) => {
    const entry = itemsRef.current.find((item) => item.key === key);
    if (entry) void send(entry);
  }, [send]);

  /** Take one out. A file already in the bucket is taken back out of it too. */
  const remove = useCallback((key: string) => {
    aborts.current.get(key)?.abort();
    aborts.current.delete(key);
    const entry = itemsRef.current.find((item) => item.key === key);
    if (entry?.staged) void discardOutreachUpload(entry.staged.objectPath);
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  /** Cancelled the whole form: nothing is left behind in the bucket. */
  const discardAll = useCallback(() => {
    for (const controller of aborts.current.values()) controller.abort();
    aborts.current.clear();
    for (const entry of itemsRef.current) if (entry.staged) void discardOutreachUpload(entry.staged.objectPath);
    setItems([]);
  }, []);

  /**
   * The record has an id at last: write a row for every file that made it up.
   *
   * Returns the attached files and one sentence for anything that did not make
   * it. The caller has already saved the record, so a problem here is reported
   * beside it and never rolls anything back.
   */
  const attachTo = useCallback(async (subjectId: string, authorName?: string): Promise<{ attached: OutreachMediaItem[]; problem: string | null }> => {
    if (!options.userId) return { attached: [], problem: 'Please sign in again to put these photos on the record.' };
    const ready = items.filter((item) => item.status === 'ready' && item.staged);
    const stillGoing = items.filter((item) => item.status === 'uploading').length;
    const failed = items.filter((item) => item.status === 'failed').length;
    const attached: OutreachMediaItem[] = [];
    let refusal: string | null = null;

    for (const entry of ready) {
      try {
        attached.push(await attachOutreachMedia({
          staged: entry.staged as StagedOutreachFile,
          subjectType: options.subjectType,
          subjectId,
          territoryId: options.territoryId,
          userId: options.userId,
          authorName,
        }));
      } catch (error) {
        // The file itself is taken back out of the bucket by the sweep below,
        // which covers every entry that ended without a row of its own.
        refusal = refusal || friendlyAttachError(error);
      }
    }

    // Anything that did NOT get a row is taken back out of the bucket, and an
    // upload still on the wire is stopped. Clearing the list without this left
    // the bytes in `outreach-private` for ever with nothing pointing at them —
    // on a 1 GB plan that is the leak DO-NOT-BREAK #58 was written to stop.
    for (const entry of items) {
      if (attached.some((item) => item.objectPath === entry.staged?.objectPath)) continue;
      aborts.current.get(entry.key)?.abort();
      aborts.current.delete(entry.key);
      if (entry.staged) void discardOutreachUpload(entry.staged.objectPath);
    }
    if (live.current) setItems([]);
    const notes: string[] = [];
    if (refusal) notes.push(refusal);
    // No promise of a second chance: a saved record has no Add button yet, so
    // the honest sentence is what happened, not what they could do about it.
    if (stillGoing) notes.push(`${stillGoing} file${stillGoing === 1 ? ' was' : 's were'} still going up when you saved, so ${stillGoing === 1 ? 'it was' : 'they were'} not attached. Everything you typed was kept.`);
    if (failed) notes.push(`${failed} file${failed === 1 ? '' : 's'} did not upload, so ${failed === 1 ? 'it was' : 'they were'} not attached.`);
    return { attached, problem: notes.length ? notes.join(' ') : null };
  }, [items, options.subjectType, options.territoryId, options.userId]);

  return { items, add, retry, remove, discardAll, attachTo, busy: items.some((item) => item.status === 'uploading') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Picking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open the camera or the library.
 *
 * The camera is asked for permission; the library is not, because the system
 * picker on iOS 14+ and Android 13+ needs none — the same choice chat makes.
 * A clip is capped at 60 seconds by the camera itself and recorded at medium
 * quality, because the ministry is on a 1 GB storage plan.
 */
async function pickOutreachFile(source: 'camera' | 'library', want: OutreachMediaKind | 'both'): Promise<ImagePicker.ImagePickerAsset | null> {
  const mediaTypes: ImagePicker.MediaType[] = want === 'photo' ? ['images'] : want === 'video' ? ['videos'] : ['images', 'videos'];
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      say('Camera access needed', 'Allow the camera in Settings, or choose a photo you have already taken.');
      return null;
    }
    result = await ImagePicker.launchCameraAsync({
      mediaTypes,
      quality: 0.85,
      videoMaxDuration: OUTREACH_VIDEO_MAX_SECONDS,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      quality: 0.85,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      allowsMultipleSelection: false,
    });
  }
  return result.canceled ? null : result.assets[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The field on a form
// ─────────────────────────────────────────────────────────────────────────────

export function OutreachMediaField({ theme, draft, label = 'Photos and video' }: { theme: AppTheme; draft: OutreachMediaDraft; label?: string }) {
  const styles = useStyles(theme);
  const [opening, setOpening] = useState(false);
  const [viewing, setViewing] = useState<{ uri: string; kind: OutreachMediaKind } | null>(null);

  async function choose(source: 'camera' | 'library', want: OutreachMediaKind | 'both') {
    if (opening) return;
    setOpening(true);
    try {
      const asset = await pickOutreachFile(source, want);
      if (!asset) return;
      const refusal = draft.add(asset);
      if (refusal) say('Not added', refusal);
    } catch (error) {
      say('That did not open', friendlyUploadError(error, 'The camera or your photos could not be opened just now.'));
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldHint}>{OUTREACH_VIDEO_GUIDANCE} Only the outreach team can see them.</Text>

      <View style={styles.buttonRow}>
        {Platform.OS !== 'web' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Take a photo or record a clip" accessibilityState={{ busy: opening }} onPress={() => choose('camera', 'both')} style={styles.addButton}>
            <Ionicons name="camera" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.addButtonText}>Camera</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Add a photo from this phone" accessibilityState={{ busy: opening }} onPress={() => choose('library', 'photo')} style={styles.addButton}>
          <Ionicons name="images" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.addButtonText}>Photo</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add a video, up to ${OUTREACH_VIDEO_MAX_SECONDS} seconds`} accessibilityState={{ busy: opening }} onPress={() => choose('library', 'video')} style={styles.addButton}>
          <Ionicons name="videocam" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.addButtonText}>Video</Text>
        </Pressable>
      </View>

      {draft.items.length ? (
        <View style={styles.tiles}>
          {draft.items.map((item) => (
            <View key={item.key} style={styles.tile}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Photo'} you are adding. Open it`}
                onPress={() => setViewing({ uri: item.staged?.url || item.localUri, kind: item.kind })}
                style={styles.tileTap}
              >
                {item.kind === 'photo' ? (
                  <Image source={{ uri: item.localUri }} style={styles.tileImage} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" />
                ) : (
                  <View style={styles.tileVideo}>
                    <Ionicons name="videocam" size={22} color={theme.colors.accent} />
                  </View>
                )}
                {/* Nothing written inside the picture box: it is a fixed size,
                    and a person reading at 200% would have it cut off. The
                    words live in the line underneath, which can grow. */}
                {item.status === 'uploading' ? (
                  <View style={styles.tileVeil}><ActivityIndicator color={theme.colors.textOnAccent} /></View>
                ) : null}
                {item.status === 'failed' ? (
                  <View style={styles.tileVeil}>
                    <Ionicons name="alert-circle" size={22} color={theme.colors.textOnAccent} />
                  </View>
                ) : null}
              </Pressable>

              {/* Real bytes on the wire, not a guess — and spoken as a number
                  so a screen reader is told as much as an eye is. */}
              {item.status === 'uploading' ? (
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Sending this file"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(item.progress * 100) }}
                  style={styles.track}
                >
                  <View style={[styles.trackFill, { width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }]} />
                </View>
              ) : null}

              <View style={styles.tileBar}>
                {item.status === 'failed' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Try sending this file again" onPress={() => draft.retry(item.key)} style={styles.tileAction}>
                    <Text style={styles.tileActionText}>Try again</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.tileStatus}>
                    {item.status === 'ready'
                      ? `Added${durationLabel(item.durationMs) ? ` · ${durationLabel(item.durationMs)}` : ''}`
                      : `Sending ${Math.round(item.progress * 100)}%`}
                  </Text>
                )}
                <Pressable accessibilityRole="button" accessibilityLabel="Take this file off" onPress={() => draft.remove(item.key)} hitSlop={12} style={styles.tileRemove}>
                  <Ionicons name="close" size={16} color={theme.colors.danger} />
                </Pressable>
              </View>
              {item.status === 'failed' && item.error ? <Text style={styles.tileError}>{item.error}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      <MediaViewer theme={theme} uri={viewing?.uri || null} kind={viewing?.kind || 'photo'} onClose={() => setViewing(null)} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The thumbnails on a record that is already saved
// ─────────────────────────────────────────────────────────────────────────────

export function OutreachMediaStrip({
  theme,
  items,
  userId,
  isStaff,
  onRemoved,
}: {
  theme: AppTheme;
  items: OutreachMediaItem[];
  userId: string | null | undefined;
  isStaff: boolean;
  /** Called after a file has really gone, so the screen can drop it. */
  onRemoved?: (item: OutreachMediaItem) => void;
}) {
  const styles = useStyles(theme);
  const [viewing, setViewing] = useState<OutreachMediaItem | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!items.length) return null;

  async function reallyRemove(item: OutreachMediaItem) {
    setRemoving(item.id);
    try {
      const outcome = await removeOutreachMedia(item);
      setViewing(null);
      onRemoved?.(item);
      // The record is clean either way. If our own copy could not be deleted
      // as well, say so plainly rather than claiming it is gone for good.
      if (!outcome.fileDeleted) {
        say('Taken off the record', 'Nobody will see it on this record again. Our own copy could not be deleted just now — an admin can clear it later.');
      }
    } catch (error) {
      say('Not removed', friendlyRemoveError(error));
    } finally {
      setRemoving(null);
    }
  }

  function confirmRemove(item: OutreachMediaItem) {
    const question = `Take this ${item.kind === 'video' ? 'video' : 'photo'} off the record?`;
    const detail = 'It is deleted for the whole team and cannot be brought back.';
    // Alert.alert with buttons does nothing in a browser (DO-NOT-BREAK #47),
    // so the web build asks the same question the way a browser can.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`${question}\n\n${detail}`)) void reallyRemove(item);
      return;
    }
    Alert.alert(question, detail, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void reallyRemove(item) },
    ]);
  }

  return (
    <View style={styles.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {items.map((item) => (
          <View key={item.id} style={styles.stripItem}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={describeMedia(item)}
              onPress={() => setViewing(item)}
              style={styles.stripTile}
            >
              {item.kind === 'photo' && item.url ? (
                <Image source={{ uri: item.url }} style={styles.tileImage} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" />
              ) : (
                <View style={styles.tileVideo}>
                  <Ionicons name={item.kind === 'video' ? 'videocam' : 'image'} size={20} color={theme.colors.accent} />
                </View>
              )}
            </Pressable>
            {/* Under the picture, not inside it, so it can never be clipped. */}
            {item.kind === 'video' && durationLabel(item.durationMs) ? <Text style={styles.tileMeta}>{durationLabel(item.durationMs)}</Text> : null}
            {!item.url ? <Text style={styles.tileMeta}>Cannot open</Text> : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={Boolean(viewing)} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerCard}>
            <View style={styles.viewerHead}>
              <Text style={styles.viewerTitle}>
                {viewing ? `${viewing.kind === 'video' ? 'Video' : 'Photo'} from ${viewing.authorName}` : ''}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close this file" onPress={() => setViewing(null)} hitSlop={10} style={styles.viewerClose}>
                <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
            <View style={styles.viewerStage}>
              {viewing?.url ? (
                viewing.kind === 'video' ? <InlineVideo uri={viewing.url} style={styles.viewerMedia} /> : (
                  <Image source={{ uri: viewing.url }} style={styles.viewerMedia} contentFit="contain" accessibilityLabel="The photo, full size" />
                )
              ) : (
                <Text style={styles.viewerNote}>This file could not be opened just now. Pull down on the record to try again.</Text>
              )}
            </View>
            {viewing?.caption ? <Text style={styles.viewerCaption}>{viewing.caption}</Text> : null}
            {viewing && canRemoveMedia(viewing, userId, isStaff) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take this file off the record"
                accessibilityState={{ busy: removing === viewing.id }}
                disabled={removing === viewing.id}
                onPress={() => confirmRemove(viewing)}
                style={styles.viewerRemove}
              >
                {removing === viewing.id ? <ActivityIndicator color={theme.colors.danger} /> : <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />}
                <Text style={styles.viewerRemoveText}>{removing === viewing.id ? 'Removing…' : 'Remove'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** A local player for one clip. No background flags: it never touches NowPlaying. */
function InlineVideo({ uri, style }: { uri: string; style: any }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls contentFit="contain" style={style} />;
}

/** The pop-up used by the form, before anything has a row of its own. */
function MediaViewer({ theme, uri, kind, onClose }: { theme: AppTheme; uri: string | null; kind: OutreachMediaKind; onClose: () => void }) {
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.viewerBackdrop, { paddingTop: insets.top + 12, paddingBottom: Math.max(12, insets.bottom) }]}>
        <View style={styles.viewerCard}>
          <View style={styles.viewerHead}>
            <Text style={styles.viewerTitle}>{kind === 'video' ? 'Your video' : 'Your photo'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close this file" onPress={onClose} hitSlop={10} style={styles.viewerClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.viewerStage}>
            {uri ? (
              kind === 'video'
                ? <InlineVideo uri={uri} style={styles.viewerMedia} />
                : <Image source={{ uri }} style={styles.viewerMedia} contentFit="contain" accessibilityLabel="The photo, full size" />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** A thumbnail is 86 points square: comfortably over the 48-point minimum. */
const TILE = 86;

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  field: { gap: t.spacing.sm, marginTop: t.spacing.sm },
  fieldLabel: { color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '800' },
  fieldHint: { color: t.colors.textMuted, fontSize: t.type.overline, lineHeight: 18 },

  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  addButton: { minHeight: 48, minWidth: 96, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder },
  addButtonText: { color: t.colors.textPrimary, fontSize: t.type.meta, fontWeight: '800' },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  tile: { width: 110, gap: 4 },
  tileTap: { width: 110, height: 86, minWidth: 48, minHeight: 48, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border },
  tileImage: { width: '100%', height: '100%' },
  tileVideo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileMeta: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700' },
  tileVeil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: t.colors.overlay },
  tileVeilText: { color: t.colors.textOnAccent, fontSize: t.type.overline, fontWeight: '900' },
  tileBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  tileStatus: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '700' },
  tileAction: { minHeight: 48, minWidth: 80, justifyContent: 'center' },
  tileActionText: { color: t.colors.accent, fontSize: t.type.overline, fontWeight: '900' },
  tileRemove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  tileError: { color: t.colors.danger, fontSize: t.type.overline, lineHeight: 16 },
  track: { height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.accentMuted, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },

  strip: { marginTop: 6 },
  stripRow: { gap: t.spacing.sm, paddingRight: t.spacing.sm, alignItems: 'flex-start' },
  stripItem: { width: 86, gap: 2 },
  stripTile: { width: 86, height: 86, minWidth: 48, minHeight: 48, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border },

  viewerBackdrop: { flex: 1, padding: t.spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.overlay },
  // Opaque in both themes: DO-NOT-BREAK #43.
  viewerCard: { width: '100%', maxWidth: 520, flexShrink: 1, borderRadius: t.radius.xl, backgroundColor: t.colors.sheet, borderWidth: 1, borderColor: t.colors.borderStrong, padding: t.spacing.md, gap: t.spacing.sm, ...t.elevation.high },
  viewerHead: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  viewerTitle: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '900' },
  viewerClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  viewerStage: { minHeight: 320, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken },
  viewerMedia: { width: '100%', height: 320 },
  viewerNote: { color: t.colors.textSecondary, fontSize: t.type.body, textAlign: 'center', paddingHorizontal: t.spacing.lg },
  viewerCaption: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20 },
  viewerRemove: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: t.radius.md, backgroundColor: t.colors.dangerMuted },
  viewerRemoveText: { color: t.colors.danger, fontSize: t.type.meta, fontWeight: '900' },
}));
