// WhatsApp-style attachments for chat: a bottom sheet with big round choices,
// a preview with a caption before sending, and bubbles that show the photo,
// video, or file inline.
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChatAttachment, ChatAttachmentKind, attachmentKindFromMime } from '../lib/chatService';
import { colors, shadows } from '../lib/theme';

export type PickedFile = { uri: string; name?: string | null; mimeType?: string | null; size?: number | null; kind: ChatAttachmentKind; width?: number; height?: number };

type Choice = { key: 'camera' | 'photos' | 'video' | 'document'; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string };
const CHOICES: Choice[] = [
  { key: 'camera', label: 'Camera', icon: 'camera', tint: '#E0457B' },
  { key: 'photos', label: 'Photos', icon: 'images', tint: '#7C4DFF' },
  { key: 'video', label: 'Video', icon: 'videocam', tint: '#FF7A00' },
  { key: 'document', label: 'Document', icon: 'document-text', tint: '#3C7DFF' },
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
    if (!permission.granted) return null;
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

export function AttachSheet({ visible, dark, onClose, onPicked }: { visible: boolean; dark: boolean; onClose: () => void; onPicked: (file: PickedFile) => void }) {
  async function choose(choice: Choice['key']) {
    onClose();
    const file = await pick(choice).catch(() => null);
    if (file) onPicked(file);
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close attachment choices">
        <View style={[styles.sheet, dark && styles.sheetDark]}>
          <View style={styles.grid}>
            {CHOICES.map((choice) => (
              <Pressable key={choice.key} accessibilityRole="button" accessibilityLabel={choice.label} onPress={() => choose(choice.key)} style={styles.choice}>
                <View style={[styles.choiceIcon, { backgroundColor: choice.tint }]}>
                  <Ionicons name={choice.icon} size={26} color={colors.white} />
                </View>
                <Text style={[styles.choiceLabel, dark && styles.choiceLabelDark]}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

export function AttachmentPreview({ file, dark, sending, onCancel, onSend }: { file: PickedFile | null; dark: boolean; sending: boolean; onCancel: () => void; onSend: (caption: string) => void }) {
  const [caption, setCaption] = useState('');
  if (!file) return null;
  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.previewRoot}>
        <View style={styles.previewTop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel attachment" onPress={onCancel} hitSlop={10} style={styles.previewClose}>
            <Ionicons name="close" size={26} color={colors.white} />
          </Pressable>
          <Text numberOfLines={1} style={styles.previewName}>{file.name || (file.kind === 'image' ? 'Photo' : file.kind === 'video' ? 'Video' : 'File')}</Text>
        </View>
        <View style={styles.previewStage}>
          {file.kind === 'image' ? (
            <Image source={{ uri: file.uri }} contentFit="contain" style={styles.previewImage} />
          ) : (
            <View style={styles.previewFile}>
              <Ionicons name={file.kind === 'video' ? 'videocam' : file.kind === 'audio' ? 'musical-notes' : 'document-text'} size={64} color={colors.gold} />
              <Text style={styles.previewFileText}>{file.kind === 'video' ? 'Video ready to send' : file.kind === 'audio' ? 'Audio ready to send' : 'Document ready to send'}</Text>
              {file.size ? <Text style={styles.previewFileMeta}>{formatSize(file.size)}</Text> : null}
            </View>
          )}
        </View>
        <View style={styles.previewBar}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Add a caption..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.captionInput}
            multiline
            editable={!sending}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send attachment" disabled={sending} onPress={() => onSend(caption.trim())} style={styles.previewSend}>
            {sending ? <ActivityIndicator color="#071231" /> : <Ionicons name="send" size={20} color="#071231" />}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function AttachmentBubble({ attachment, dark, own, onOpen }: { attachment: ChatAttachment; dark: boolean; own: boolean; onOpen: (attachment: ChatAttachment) => void }) {
  if (attachment.kind === 'image') {
    return (
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open photo" onPress={() => onOpen(attachment)} style={styles.imageWrap}>
        <Image source={{ uri: attachment.url }} contentFit="cover" transition={150} style={styles.image} cachePolicy="memory-disk" />
      </Pressable>
    );
  }
  if (attachment.kind === 'video') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => onOpen(attachment)} style={styles.videoWrap}>
        <View style={styles.videoPlay}><Ionicons name="play" size={28} color={colors.white} /></View>
        <Text style={styles.videoLabel}>Video{attachment.size ? ` • ${formatSize(attachment.size)}` : ''}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${attachment.name || 'file'}`} onPress={() => onOpen(attachment)} style={[styles.fileRow, dark && styles.fileRowDark, own && styles.fileRowOwn]}>
      <View style={[styles.fileIcon, dark && styles.fileIconDark]}>
        <Ionicons name={attachment.kind === 'audio' ? 'musical-notes' : 'document-text'} size={20} color={dark ? colors.gold : colors.royalBlue} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.fileName, dark && styles.fileNameDark]}>{attachment.name || 'File'}</Text>
        <Text style={[styles.fileMeta, dark && styles.fileMetaDark]}>{attachment.kind === 'audio' ? 'Audio' : 'Document'}{attachment.size ? ` • ${formatSize(attachment.size)}` : ''}</Text>
      </View>
      <Ionicons name={attachment.kind === 'audio' ? 'play-circle' : 'download-outline'} size={22} color={dark ? colors.gold : colors.deepGold} />
    </Pressable>
  );
}

export function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Modal visible={Boolean(url)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel="Close photo">
        {url ? <Image source={{ uri: url }} contentFit="contain" style={styles.viewerImage} /> : null}
        <View style={styles.viewerClose}><Ionicons name="close" size={28} color={colors.white} /></View>
      </Pressable>
    </Modal>
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,8,23,0.45)' },
  sheet: { margin: 12, marginBottom: 24, borderRadius: 22, backgroundColor: colors.white, padding: 18, ...shadows.soft },
  sheetDark: { backgroundColor: '#0B1F4D' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 18 },
  choice: { width: '25%', alignItems: 'center', gap: 8 },
  choiceIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  choiceLabel: { color: colors.slate, fontSize: 12, fontWeight: '700' },
  choiceLabelDark: { color: 'rgba(255,255,255,0.8)' },
  previewRoot: { flex: 1, backgroundColor: '#020817' },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 54, paddingHorizontal: 16, paddingBottom: 10 },
  previewClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  previewName: { flex: 1, color: colors.white, fontWeight: '800' },
  previewStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  previewFile: { alignItems: 'center', gap: 10 },
  previewFileText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  previewFileMeta: { color: 'rgba(255,255,255,0.6)' },
  previewBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, paddingBottom: 34 },
  captionInput: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 23, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.12)', color: colors.white },
  previewSend: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { marginTop: 6, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(15,23,42,0.06)' },
  image: { width: 220, height: 220 },
  videoWrap: { marginTop: 6, width: 220, height: 150, borderRadius: 14, backgroundColor: '#0B1F4D', alignItems: 'center', justifyContent: 'center', gap: 8 },
  videoPlay: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  videoLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  fileRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.05)' },
  fileRowDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  fileRowOwn: { backgroundColor: 'rgba(255,255,255,0.35)' },
  fileIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  fileIconDark: { backgroundColor: 'rgba(255,255,255,0.1)' },
  fileName: { color: colors.royalBlue, fontWeight: '800', fontSize: 13 },
  fileNameDark: { color: colors.white },
  fileMeta: { color: colors.slate, fontSize: 11, marginTop: 1 },
  fileMetaDark: { color: 'rgba(255,255,255,0.65)' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 54, right: 18 },
});
