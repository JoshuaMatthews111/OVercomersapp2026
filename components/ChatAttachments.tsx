// Attachments for chat: a bottom sheet with big round choices, a preview with
// a caption before sending, and bubbles that show the photo, video or file
// inline — in the shape it was actually chosen in, never centre-cropped.
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image, ImageLoadEventData } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { friendlyError } from '../lib/errorMessages';
import { ChatAttachment, ChatAttachmentKind, attachmentKindFromMime, chatAttachmentLimitBytes } from '../lib/chatService';
import { formatBytes, tooLargeMessage } from '../lib/uploadService';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import { isVoiceNote } from '../lib/voiceNotes';
import { VoiceNoteBubble } from './VoiceNotePlayer';

export type PickedFile = { uri: string; name?: string | null; mimeType?: string | null; size?: number | null; kind: ChatAttachmentKind; width?: number; height?: number };

/** The bubble is this wide; a picture is fitted inside it, never cropped to it. */
const BUBBLE_WIDTH = 240;
const BUBBLE_MAX_HEIGHT = 320;
const WIDEST = 2.2;
const TALLEST = BUBBLE_WIDTH / BUBBLE_MAX_HEIGHT;

/** Keep a picture's own shape, within what a message bubble can hold. */
function clampAspect(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return Math.min(WIDEST, Math.max(TALLEST, width / height));
}

type Choice = { key: 'camera' | 'photos' | 'video' | 'document'; label: string; icon: keyof typeof Ionicons.glyphMap };
const CHOICES: Choice[] = [
  { key: 'camera', label: 'Camera', icon: 'camera' },
  { key: 'photos', label: 'Photos', icon: 'images' },
  { key: 'video', label: 'Video', icon: 'videocam' },
  { key: 'document', label: 'Document', icon: 'document-text' },
];

async function pick(choice: Choice['key']): Promise<PickedFile | null> {
  if (choice === 'document') {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return null;
    return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size, kind: attachmentKindFromMime(asset.mimeType) };
  }
  let result: ImagePicker.ImagePickerResult;
  if (choice === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert('Camera access needed', 'Allow camera access in Settings, or choose a photo from your library.'); return null; }
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 120 });
  } else {
    // The system picker needs no library permission on iOS 14+ / Android 13+.
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: choice === 'video' ? ['videos'] : ['images'],
      quality: 0.85,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      allowsMultipleSelection: false,
    });
  }
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const mime = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  return { uri: asset.uri, name: asset.fileName, mimeType: mime, size: asset.fileSize, kind: attachmentKindFromMime(mime), width: asset.width, height: asset.height };
}

export function AttachSheet({ visible, dark, onClose, onPicked, onSong }: { visible: boolean; dark: boolean; onClose: () => void; onPicked: (file: PickedFile) => void; /** Song choice (2026-09-22): opens the church's songs from Media. */ onSong?: () => void }) {
  const pendingChoice = useRef<Choice['key'] | null>(null);
  const pendingSong = useRef(false);
  const insets = useSafeAreaInsets();
  const styles = useStyles(getTheme(dark));

  async function openPicker() {
    if (pendingSong.current) { pendingSong.current = false; onSong?.(); return; }
    const choice = pendingChoice.current;
    pendingChoice.current = null;
    if (!choice) return;
    try {
      const file = await pick(choice);
      if (!file) return;
      // Say no here, instantly, rather than after a long upload that fails.
      if (file.size && file.size > chatAttachmentLimitBytes()) {
        return Alert.alert('That file is too big to send', tooLargeMessage('chat-attachments', file.size));
      }
      onPicked(file);
    } catch (err) {
      Alert.alert('We could not open that', friendlyError(err, 'Please try choosing the file again.'));
    }
  }

  function chooseSong() {
    if (pendingChoice.current || pendingSong.current) return;
    pendingSong.current = true;
    onClose();
    // Same as the pickers: iOS opens the next sheet only after this one has gone.
    if (Platform.OS !== 'ios') void openPicker();
  }

  function choose(choice: Choice['key']) {
    if (pendingChoice.current) return;
    pendingChoice.current = choice;
    onClose();
    // iOS cannot present the system picker while its parent modal dismisses.
    if (Platform.OS !== 'ios') openPicker();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={openPicker}>
      <View style={styles.backdrop}>
        {/* The dismiss area is its own layer, so a tap on the sheet cannot
            close the sheet by accident. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close attachment choices" />
        <View style={[styles.sheet, { marginBottom: Math.max(12, insets.bottom) }]}>
          <Text style={styles.sheetHeading}>Send something</Text>
          <View style={styles.grid}>
            {CHOICES.map((choice) => (
              <Pressable key={choice.key} accessibilityRole="button" accessibilityLabel={choice.label} onPress={() => choose(choice.key)} style={styles.choice}>
                <View style={styles.choiceIcon}>
                  <Ionicons name={choice.icon} size={26} color={getTheme(dark).colors.textOnAccent} />
                </View>
                <Text style={styles.choiceLabel}>{choice.label}</Text>
              </Pressable>
            ))}
            {onSong ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Song from Media" onPress={chooseSong} style={styles.choice}>
                <View style={styles.choiceIcon}>
                  <Ionicons name="musical-notes" size={26} color={getTheme(dark).colors.textOnAccent} />
                </View>
                <Text style={styles.choiceLabel}>Song</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The full-screen check before sending. It is deliberately dark in both
 * themes, the way a photo viewer is, so the picture is what you look at.
 *
 * Pressing send closes this at once: the picture goes straight into the
 * conversation with its own progress bar, so nobody waits on a modal.
 */
export function AttachmentPreview({ file, dark, sending, onCancel, onSend }: {
  file: PickedFile | null;
  dark: boolean;
  sending: boolean;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const [caption, setCaption] = useState('');
  const insets = useSafeAreaInsets();
  const styles = useStyles(getTheme(true));
  useEffect(() => { setCaption(''); }, [file?.uri]);
  if (!file) return null;
  const kindWord = file.kind === 'image' ? 'Photo' : file.kind === 'video' ? 'Video' : 'File';
  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={() => { if (!sending) onCancel(); }}>
      <KeyboardAvoidingView style={styles.previewRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.previewTop, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel this attachment" disabled={sending} onPress={onCancel} hitSlop={10} style={styles.previewClose}>
            <Ionicons name="close" size={26} color={getTheme(true).colors.textPrimary} />
          </Pressable>
          <Text numberOfLines={1} adjustsFontSizeToFit={true} style={styles.previewName}>{file.name || kindWord}</Text>
        </View>
        <View style={styles.previewStage}>
          {file.kind === 'image' ? (
            <Image source={{ uri: file.uri }} accessibilityLabel="The photo you are about to send" contentFit="contain" style={styles.previewImage} />
          ) : file.kind === 'video' ? <VideoPreview uri={file.uri} /> : (
            <View style={styles.previewFile}>
              <Ionicons name={file.kind === 'audio' ? 'musical-notes' : 'document-text'} size={64} color={getTheme(true).colors.accent} />
              <Text style={styles.previewFileText}>{file.kind === 'audio' ? 'Audio ready to send' : 'Document ready to send'}</Text>
              {file.size ? <Text style={styles.previewFileMeta}>{formatBytes(file.size)}</Text> : null}
            </View>
          )}
        </View>


        <View style={[styles.previewBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Add a caption"
            accessibilityLabel="Caption for this attachment"
            placeholderTextColor={getTheme(true).colors.textMuted}
            style={styles.captionInput}
            multiline
            editable={!sending}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sending ? 'Sending' : 'Send this attachment'}
            disabled={sending}
            onPress={() => onSend(caption.trim())}
            style={[styles.previewSend, sending && styles.previewSendBusy]}
          >
            {sending ? <ActivityIndicator color={getTheme(true).colors.textOnAccent} /> : <Ionicons name="send" size={20} color={getTheme(true).colors.textOnAccent} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  const styles = useStyles(getTheme(true));
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.previewImage} />;
}

/** A determinate bar. Nothing here is decorative — it only ever shows real bytes. */
export function ProgressTrack({ fraction, dark }: { fraction: number; dark: boolean }) {
  const styles = useStyles(getTheme(dark));
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.trackFill, { width }]} />
    </View>
  );
}

export function AttachmentBubble({ attachment, dark, own, sendingProgress, onOpen }: {
  attachment: ChatAttachment;
  dark: boolean;
  own: boolean;
  sendingProgress?: number;
  onOpen: (attachment: ChatAttachment) => void;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  // Stays true until the sent message replaces this one, so the bar does not
  // vanish during the last moment between "all bytes sent" and "it is posted".
  const uploading = typeof sendingProgress === 'number';

  // The shape comes from the picture itself. What was sent is what is shown.
  const [measured, setMeasured] = useState<number | null>(clampAspect(attachment.width, attachment.height));
  const onLoad = useCallback((event: ImageLoadEventData) => {
    const next = clampAspect(event.source?.width, event.source?.height);
    if (next) setMeasured(next);
  }, []);
  const aspect = measured ?? 4 / 3;

  // A voice note plays right here in the message, not in the big player.
  if (isVoiceNote(attachment)) {
    return (
      <VoiceNoteBubble
        id={attachment.path || attachment.url}
        url={attachment.url}
        durationMs={attachment.durationMs}
        own={own}
        dark={dark}
        sendingProgress={sendingProgress}
        size={attachment.size}
      />
    );
  }

  if (attachment.kind === 'image') {
    return (
      <View>
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={uploading ? 'Photo, still sending' : 'Open this photo full screen'}
          onPress={() => onOpen(attachment)}
          style={styles.imageWrap}
        >
          <Image
            source={{ uri: attachment.url }}
            accessibilityLabel="Photo in this message"
            contentFit="contain"
            transition={150}
            onLoad={onLoad}
            style={[styles.image, { aspectRatio: aspect }]}
            cachePolicy="memory-disk"
          />
        </Pressable>
        {uploading ? <SendingFoot fraction={sendingProgress ?? 0} dark={dark} size={attachment.size} /> : null}
      </View>
    );
  }
  if (attachment.kind === 'video') {
    return (
      <View>
        <Pressable accessibilityRole="button" accessibilityLabel="Play this video" onPress={() => onOpen(attachment)} style={styles.videoWrap}>
          <View style={styles.videoPlay}><Ionicons name="play" size={28} color={theme.colors.textPrimary} /></View>
          <Text style={styles.videoLabel}>Video{attachment.size ? ` • ${formatBytes(attachment.size)}` : ''}</Text>
        </Pressable>
        {uploading ? <SendingFoot fraction={sendingProgress ?? 0} dark={dark} size={attachment.size} /> : null}
      </View>
    );
  }
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${attachment.name || 'this file'}`} onPress={() => onOpen(attachment)} style={[styles.fileRow, own && styles.fileRowOwn]}>
        <View style={styles.fileIcon}>
          <Ionicons name={attachment.kind === 'audio' ? 'musical-notes' : 'document-text'} size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit={true} style={styles.fileName}>{attachment.name || 'File'}</Text>
          <Text style={styles.fileMeta}>{attachment.kind === 'audio' ? 'Audio' : 'Document'}{attachment.size ? ` • ${formatBytes(attachment.size)}` : ''}</Text>
        </View>
        <Ionicons name={attachment.kind === 'audio' ? 'play-circle' : 'download-outline'} size={22} color={theme.colors.accent} />
      </Pressable>
      {uploading ? <SendingFoot fraction={sendingProgress ?? 0} dark={dark} size={attachment.size} /> : null}
    </View>
  );
}

/** Under an outgoing attachment while it is still on its way. */
function SendingFoot({ fraction, dark, size }: { fraction: number; dark: boolean; size?: number }) {
  const styles = useStyles(getTheme(dark));
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View style={styles.sendingFoot}>
      <ProgressTrack fraction={fraction} dark={dark} />
      <Text style={styles.sendingFootText}>{pct >= 100 ? 'Almost there…' : `Sending ${pct}%${size ? ` of ${formatBytes(size)}` : ''}`}</Text>
    </View>
  );
}

export function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(getTheme(true));
  return (
    <Modal visible={Boolean(url)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close this photo">
        {url ? <Image source={{ uri: url }} accessibilityLabel="Photo, full screen" contentFit="contain" style={styles.viewerImage} /> : null}
        <View style={[styles.viewerClose, { top: insets.top + 12 }]}>
          <Ionicons name="close" size={28} color={getTheme(true).colors.textPrimary} />
        </View>
      </Pressable>
    </Modal>
  );
}

/** Kept for call sites that still ask this module how big something is. */
export function formatSize(bytes: number) {
  return formatBytes(bytes);
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  backdrop: { flex: 1, minHeight: 200, justifyContent: 'flex-end', backgroundColor: t.colors.overlay },
  sheet: { margin: 12, marginBottom: 24, borderRadius: t.radius.xl, backgroundColor: t.colors.sheet, borderWidth: 1, borderColor: t.colors.borderStrong, padding: 18, ...t.elevation.high },
  sheetHeading: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 18 },
  choice: { minWidth: 76, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 4 },
  choiceIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSolid },
  choiceLabel: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700' },

  previewRoot: { flex: 1, backgroundColor: t.colors.pageTop },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 54, paddingHorizontal: 16, paddingBottom: 10 },
  previewClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  previewName: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  previewStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  previewFile: { alignItems: 'center', gap: 10 },
  previewFileText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.cardTitle },
  previewFileMeta: { color: t.colors.textMuted, fontSize: t.type.meta },
  previewBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, paddingBottom: 34 },
  captionInput: {
    flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: t.colors.pageBottom, borderWidth: 1, borderColor: t.colors.borderStrong, color: t.colors.textPrimary, fontSize: t.type.body,
  },
  previewSend: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  previewSendBusy: { opacity: 0.7 },

  track: { height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.accentMuted, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
  sendingFoot: { marginTop: 6, gap: 4 },
  sendingFootText: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '700' },

  imageWrap: { marginTop: 6, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken },
  image: { width: BUBBLE_WIDTH, maxWidth: '100%', maxHeight: BUBBLE_MAX_HEIGHT },
  videoWrap: { marginTop: 6, width: BUBBLE_WIDTH, minHeight: 150, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  videoPlay: { width: 54, height: 54, borderRadius: 27, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  videoLabel: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700' },
  fileRow: { marginTop: 6, alignSelf: 'stretch', minWidth: 200, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken },
  fileRowOwn: { backgroundColor: t.colors.accentMuted },
  fileIcon: { width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  fileName: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  fileMeta: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: 1 },

  viewer: { flex: 1, minWidth: 200, minHeight: 200, backgroundColor: t.colors.scrim, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 54, right: 18, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
}));
