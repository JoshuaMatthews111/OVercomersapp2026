import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AdminWorkbench,
  grantUserRole,
  getAdminWorkbench,
  moderateMessage,
  PushAudience,
  revokeUserRole,
  sendAdminPush,
  setMediaStatus,
  setStoryStatus,
  updateMediaRecord,
  updatePrayerWorkflow,
} from '../lib/adminManagementService';
import { AdminDashboard, getAdminDashboard } from '../lib/adminService';
import { useAccessProfile } from '../lib/accessControl';
import { createAdminEvent, createAdminMediaItem, createAdminStory } from '../lib/contentService';
import { friendlyError } from '../lib/errorMessages';
import { colors, shadows } from '../lib/theme';
import { useThemePreference } from '../lib/themePreference';
import { uploadDocumentAsset, uploadPickedAsset } from '../lib/uploadService';
import { AppRole, MediaKind } from '../types/models';

type AdminAction = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const actions: AdminAction[] = [
  { title: 'Stories', subtitle: 'Regions, testimonies, alerts', icon: 'images-outline', route: '/(tabs)' },
  { title: 'Media Uploads', subtitle: 'Sermons, articles, video, music', icon: 'cloud-upload-outline', route: '/(tabs)/messages' },
  { title: 'Sermon Files', subtitle: 'Audio, video, thumbnails', icon: 'folder-open-outline', route: '/(tabs)/messages' },
  { title: 'Roles', subtitle: 'Members, leaders, admins', icon: 'shield-checkmark-outline', route: '/(tabs)/profile' },
  { title: 'Prayer Requests', subtitle: 'New, praying, answered', icon: 'hand-left-outline', route: '/prayer' },
  { title: 'Chat Moderation', subtitle: 'Rooms, members, announcements', icon: 'chatbubbles-outline', route: '/(tabs)/community' },
  { title: 'Evangelism Data', subtitle: 'Territories and follow-up', icon: 'map-outline', route: '/evangelism' },
];

const roleOptions: AppRole[] = ['member', 'prayer_team', 'media_admin', 'moderator', 'outreach', 'staff', 'leader', 'admin', 'super_admin'];
const prayerStatuses = ['new', 'praying', 'follow_up', 'answered', 'closed'];
const pushAudiences: PushAudience[] = ['announcements', 'sermons', 'articles', 'chat', 'prayer', 'all'];

export default function AdminScreen() {
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [workbench, setWorkbench] = useState<AdminWorkbench | null>(null);
  const [savingStory, setSavingStory] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [working, setWorking] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [selectedMediaFileName, setSelectedMediaFileName] = useState('');
  const [selectedStoryImageName, setSelectedStoryImageName] = useState('');
  const [selectedEventFlyerName, setSelectedEventFlyerName] = useState('');
  const [selectedCoverName, setSelectedCoverName] = useState('');
  const [showStoryAdvanced, setShowStoryAdvanced] = useState(false);
  const [showMediaAdvanced, setShowMediaAdvanced] = useState(false);
  const [showEventAdvanced, setShowEventAdvanced] = useState(false);
  const [roleForm, setRoleForm] = useState({ userId: '', role: 'member' as AppRole });
  const [prayerAssignee, setPrayerAssignee] = useState('');
  const [pushForm, setPushForm] = useState({ title: '', body: '', audience: 'announcements' as PushAudience });
  const [mediaEdit, setMediaEdit] = useState<Record<string, { title: string; speaker: string }>>({});
  const [storyForm, setStoryForm] = useState({ title: '', category: '', region: '', body: '', imageUrl: '', actionUrl: '' });
  const [eventForm, setEventForm] = useState({
    title: '',
    startsAt: '',
    location: '',
    description: '',
    imageUrl: '',
    registrationUrl: '',
  });
  const [mediaForm, setMediaForm] = useState({
    mediaType: 'sermon' as MediaKind,
    title: '',
    speaker: '',
    scriptureReference: '',
    description: '',
    thumbnailUrl: '',
    fileUrl: '',
    externalUrl: '',
    isFeatured: false,
    isDownloadable: true,
  });

  useEffect(() => {
    refreshAdminData();
  }, []);

  async function refreshAdminData() {
    const [nextDashboard, nextWorkbench] = await Promise.all([getAdminDashboard(), getAdminWorkbench()]);
    setDashboard(nextDashboard);
    setWorkbench(nextWorkbench);
    setMediaEdit((current) => {
      const next = { ...current };
      nextWorkbench.media.forEach((item) => {
        if (!next[item.id]) next[item.id] = { title: item.title, speaker: item.speaker || '' };
      });
      return next;
    });
  }

  async function pickStoryImage() {
    setSavingStory(true);
    setUploadStatus('Selecting story image...');
    try {
      const upload = await pickImageUpload({
        bucketId: 'story-media',
        purpose: 'story',
        pathPrefix: 'stories',
        relatedTable: 'app_stories',
        onSelected: setSelectedStoryImageName,
      });
      if (upload) {
        setStoryForm((current) => ({ ...current, imageUrl: upload.publicUrl }));
        setUploadStatus(`Story image ready: ${upload.fileName}`);
      } else {
        setUploadStatus('');
      }
    } catch (err) {
      setUploadStatus('');
      Alert.alert('Image upload not completed', friendlyError(err, 'We could not upload this story image right now.'));
    } finally {
      setSavingStory(false);
    }
  }

  async function pickMediaThumbnail() {
    setSavingMedia(true);
    setUploadStatus('Selecting cover image...');
    try {
      const upload = await pickImageUpload({
        bucketId: 'app-assets',
        purpose: 'media_thumbnail',
        pathPrefix: 'media-thumbnails',
        relatedTable: 'media_items',
        onSelected: setSelectedCoverName,
      });
      if (upload) {
        setMediaForm((current) => ({ ...current, thumbnailUrl: upload.publicUrl }));
        setUploadStatus(`Cover image ready: ${upload.fileName}`);
      } else {
        setUploadStatus('');
      }
    } catch (err) {
      setUploadStatus('');
      Alert.alert('Cover upload not completed', friendlyError(err, 'We could not upload this cover image right now.'));
    } finally {
      setSavingMedia(false);
    }
  }

  async function pickMediaFile() {
    setUploadStatus('Selecting media file...');
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) {
      setUploadStatus('');
      return;
    }
    setSelectedMediaFileName(result.assets[0].name || 'Selected media file');
    setUploadStatus(`Uploading ${result.assets[0].name || 'media file'}...`);
    setSavingMedia(true);
    try {
      const upload = await uploadDocumentAsset({
        asset: result.assets[0],
        bucketId: 'app-assets',
        purpose: 'media_file',
        pathPrefix: 'media-files',
        relatedTable: 'media_items',
      });
      setMediaForm((current) => ({ ...current, fileUrl: upload.publicUrl }));
      setUploadStatus(`Media file ready: ${upload.fileName}`);
      Alert.alert('Media file uploaded', upload.fileName);
    } catch (err) {
      setUploadStatus('');
      Alert.alert('Upload not completed', friendlyError(err, 'We could not upload this media file right now.'));
    } finally {
      setSavingMedia(false);
    }
  }

  async function pickEventFlyer() {
    setSavingEvent(true);
    setUploadStatus('Selecting event flyer...');
    try {
      const upload = await pickImageUpload({
        bucketId: 'app-assets',
        purpose: 'media_thumbnail',
        pathPrefix: 'event-flyers',
        relatedTable: 'events',
        onSelected: setSelectedEventFlyerName,
      });
      if (upload) {
        setEventForm((current) => ({ ...current, imageUrl: upload.publicUrl }));
        setUploadStatus(`Event flyer ready: ${upload.fileName}`);
      } else {
        setUploadStatus('');
      }
    } catch (err) {
      setUploadStatus('');
      Alert.alert('Flyer upload not completed', friendlyError(err, 'We could not upload this event flyer right now.'));
    } finally {
      setSavingEvent(false);
    }
  }

  async function publishStory() {
    if (!storyForm.title.trim()) return Alert.alert('Story title needed', 'Add a title before publishing.');
    if (!storyForm.imageUrl) return Alert.alert('Story media needed', 'Upload an image or video before publishing this story.');
    setSavingStory(true);
    try {
      await createAdminStory({
        title: storyForm.title.trim(),
        category: storyForm.category.trim(),
        region: storyForm.region.trim(),
        body: storyForm.body.trim(),
        imageUrl: storyForm.imageUrl,
        actionUrl: storyForm.actionUrl.trim(),
      });
      setStoryForm({ title: '', category: '', region: '', body: '', imageUrl: '', actionUrl: '' });
      await refreshAdminData();
      Alert.alert('Story published', 'The app story is now available in the Home feed.');
    } catch (err) {
      Alert.alert('Story not published', friendlyError(err, 'Check admin permissions and try again.'));
    } finally {
      setSavingStory(false);
    }
  }

  async function publishMedia() {
    if (!mediaForm.title.trim()) return Alert.alert('Media title needed', 'Add a title before publishing.');
    if (!mediaForm.fileUrl && !mediaForm.externalUrl.trim()) {
      return Alert.alert('Media source needed', 'Upload a media file or paste an external video/audio URL.');
    }
    setSavingMedia(true);
    try {
      await createAdminMediaItem({
        mediaType: mediaForm.mediaType,
        title: mediaForm.title.trim(),
        speaker: mediaForm.speaker.trim(),
        scriptureReference: mediaForm.scriptureReference.trim(),
        description: mediaForm.description.trim(),
        thumbnailUrl: mediaForm.thumbnailUrl,
        fileUrl: mediaForm.fileUrl,
        externalUrl: mediaForm.externalUrl.trim(),
        isDownloadable: mediaForm.isDownloadable,
        isFeatured: mediaForm.isFeatured,
      });
      setMediaForm({
        mediaType: 'sermon',
        title: '',
        speaker: '',
        scriptureReference: '',
        description: '',
        thumbnailUrl: '',
        fileUrl: '',
        externalUrl: '',
        isFeatured: false,
        isDownloadable: true,
      });
      await refreshAdminData();
      Alert.alert('Media published', 'The media item is now available in the Media tab.');
    } catch (err) {
      Alert.alert('Media not published', friendlyError(err, 'Check admin permissions and try again.'));
    } finally {
      setSavingMedia(false);
    }
  }

  async function publishEvent() {
    if (!eventForm.title.trim()) return Alert.alert('Event title needed', 'Add a title before publishing.');
    if (!eventForm.startsAt.trim()) return Alert.alert('Date and time needed', 'Add a date/time like 2026-07-01 7:00 PM or an ISO date.');
    const parsed = new Date(eventForm.startsAt.trim());
    if (Number.isNaN(parsed.getTime())) return Alert.alert('Date format not recognized', 'Use a date/time like 2026-07-01 7:00 PM.');
    setSavingEvent(true);
    try {
      await createAdminEvent({
        title: eventForm.title.trim(),
        startsAt: parsed.toISOString(),
        description: eventForm.description.trim(),
        location: eventForm.location.trim(),
        imageUrl: eventForm.imageUrl,
        registrationUrl: eventForm.registrationUrl.trim(),
      });
      setEventForm({ title: '', startsAt: '', location: '', description: '', imageUrl: '', registrationUrl: '' });
      setSelectedEventFlyerName('');
      await refreshAdminData();
      Alert.alert('Event published', 'The event is now available on the Home tab.');
    } catch (err) {
      Alert.alert('Event not published', friendlyError(err, 'Check admin permissions and try again.'));
    } finally {
      setSavingEvent(false);
    }
  }

  async function runAdminAction(successMessage: string, action: () => Promise<unknown>) {
    setWorking(true);
    try {
      await action();
      await refreshAdminData();
      Alert.alert('Done', successMessage);
    } catch (err) {
      Alert.alert('Admin action failed', friendlyError(err, 'Check permissions and try again.'));
    } finally {
      setWorking(false);
    }
  }

  function grantRole() {
    if (!roleForm.userId.trim()) return Alert.alert('User ID needed', 'Paste the Supabase user ID before changing roles.');
    runAdminAction('Role granted.', () => grantUserRole(roleForm.userId.trim(), roleForm.role));
  }

  function revokeRole(userId = roleForm.userId, role = roleForm.role) {
    if (!userId.trim()) return Alert.alert('User ID needed', 'Paste the Supabase user ID before changing roles.');
    runAdminAction('Role removed.', () => revokeUserRole(userId.trim(), role));
  }

  function updatePrayer(id: string, status: string) {
    runAdminAction('Prayer workflow updated.', () => updatePrayerWorkflow({ id, status, assignedTo: prayerAssignee.trim() }));
  }

  function sendPushNotice() {
    if (!pushForm.title.trim() || !pushForm.body.trim()) return Alert.alert('Notification copy needed', 'Add a title and message.');
    runAdminAction('Notification sent to eligible devices.', () => sendAdminPush(pushForm).then(() => setPushForm({ title: '', body: '', audience: 'announcements' })));
  }

  function saveMediaEdit(id: string) {
    const edit = mediaEdit[id];
    if (!edit?.title.trim()) return Alert.alert('Title needed', 'Media title cannot be blank.');
    runAdminAction('Media item updated.', () => updateMediaRecord(id, { title: edit.title.trim(), speaker: edit.speaker.trim() }));
  }

  const metrics = useMemo(() => {
    const data = dashboard;
    return [
      { label: 'Stories', value: data?.stories || 0, icon: 'planet-outline' },
      { label: 'Media', value: data?.mediaItems || 0, icon: 'play-circle-outline' },
      { label: 'New Prayer', value: data?.newPrayerRequests || 0, icon: 'notifications-outline' },
      { label: 'Contacts', value: data?.outreachContacts || 0, icon: 'people-outline' },
      { label: 'Territories', value: data?.territories || 0, icon: 'map-outline' },
      { label: 'Roles', value: data?.userRoles || 0, icon: 'shield-outline' },
    ] as const;
  }, [dashboard]);

  if (!access.canManageContent) {
    return (
      <LinearGradient colors={dark ? ['#020817', '#061334'] : ['#FFFFFF', '#FFF9EE']} style={styles.root}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <SafeAreaView style={styles.safe}>
          <View style={styles.locked}>
            <Ionicons name="lock-closed-outline" size={42} color={colors.gold} />
            <Text style={[styles.title, dark && styles.titleDark]}>Admin</Text>
            <Text style={[styles.body, dark && styles.bodyDark]}>Super admin access is required.</Text>
            <Pressable onPress={() => router.back()} style={[styles.primaryButton, dark && styles.primaryButtonDark]}>
              <Text style={[styles.primaryButtonText, dark && styles.primaryButtonTextDark]}>Go Back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFF9EE', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={8} style={[styles.iconButton, dark && styles.iconButtonDark]}>
              <Ionicons name="chevron-back" size={23} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, dark && styles.kickerDark]}>SUPER ADMIN</Text>
              <Text style={[styles.title, dark && styles.titleDark]}>Admin Dashboard</Text>
            </View>
            <View style={[styles.iconButton, styles.iconButtonGold]}>
              <Ionicons name="settings" size={22} color="#071231" />
            </View>
          </View>

          <LinearGradient colors={dark ? ['#071B45', '#092866'] : ['#0B1D4D', '#123A8F']} style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="globe-outline" size={30} color="#071231" />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Overcomers Operations</Text>
              <Text style={styles.heroBody}>Content, prayer care, chat, roles, giving activity, and evangelism reporting.</Text>
            </View>
          </LinearGradient>

          <View style={styles.commandGrid}>
            {[
              { label: 'Post Story', icon: 'images-outline' as const },
              { label: 'Upload Sermon', icon: 'mic-outline' as const },
              { label: 'Upload Music', icon: 'musical-notes-outline' as const },
              { label: 'Create Event', icon: 'calendar-outline' as const },
            ].map((item) => (
              <View key={item.label} style={[styles.commandCard, dark && styles.commandCardDark]}>
                <View style={[styles.commandIcon, dark && styles.commandIconDark]}>
                  <Ionicons name={item.icon} size={22} color={dark ? colors.gold : colors.royalBlue} />
                </View>
                <Text style={[styles.commandText, dark && styles.commandTextDark]}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="images-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Publish Home Story</Text>
            </View>
            {storyForm.imageUrl ? <Image source={{ uri: storyForm.imageUrl }} style={styles.previewImage} resizeMode="cover" /> : null}
            {selectedStoryImageName ? <Text style={[styles.uploadedText, dark && styles.uploadedTextDark]}>Selected image: {selectedStoryImageName}</Text> : null}
            <TextInput value={storyForm.title} onChangeText={(title) => setStoryForm((current) => ({ ...current, title }))} placeholder="Story title" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
            <Pressable onPress={() => setShowStoryAdvanced((current) => !current)} style={[styles.moreOptions, dark && styles.moreOptionsDark]}>
              <Text style={[styles.moreOptionsText, dark && styles.moreOptionsTextDark]}>{showStoryAdvanced ? 'Hide options' : 'More options'}</Text>
              <Ionicons name={showStoryAdvanced ? 'chevron-up' : 'chevron-down'} size={16} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
            {showStoryAdvanced ? (
              <>
                <View style={styles.twoColumn}>
                  <TextInput value={storyForm.category} onChangeText={(category) => setStoryForm((current) => ({ ...current, category }))} placeholder="Category" placeholderTextColor={colors.muted} style={[styles.input, styles.halfInput, dark && styles.inputDark]} />
                  <TextInput value={storyForm.region} onChangeText={(region) => setStoryForm((current) => ({ ...current, region }))} placeholder="Region" placeholderTextColor={colors.muted} style={[styles.input, styles.halfInput, dark && styles.inputDark]} />
                </View>
                <TextInput value={storyForm.body} onChangeText={(body) => setStoryForm((current) => ({ ...current, body }))} placeholder="Story body" placeholderTextColor={colors.muted} multiline style={[styles.input, styles.textArea, dark && styles.inputDark]} />
                <TextInput value={storyForm.actionUrl} onChangeText={(actionUrl) => setStoryForm((current) => ({ ...current, actionUrl }))} placeholder="Optional link URL" placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.input, dark && styles.inputDark]} />
              </>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable onPress={pickStoryImage} disabled={savingStory} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                <Ionicons name="cloud-upload-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
                <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Upload Media</Text>
              </Pressable>
              <Pressable onPress={publishStory} disabled={savingStory} style={styles.goldButton}>
                <Text style={styles.goldButtonText}>{savingStory ? 'Publishing...' : 'Publish'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="play-circle-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Publish Media</Text>
            </View>
            <View style={styles.kindRow}>
              {(['sermon', 'article', 'video', 'music', 'live', 'devotional'] as MediaKind[]).map((kind) => (
                <Pressable key={kind} onPress={() => setMediaForm((current) => ({ ...current, mediaType: kind }))} style={[styles.kindPill, dark && styles.kindPillDark, mediaForm.mediaType === kind && styles.kindPillActive]}>
                  <Text style={[styles.kindText, dark && styles.kindTextDark, mediaForm.mediaType === kind && styles.kindTextActive]}>{kind}</Text>
                </Pressable>
              ))}
            </View>
            {mediaForm.thumbnailUrl ? <Image source={{ uri: mediaForm.thumbnailUrl }} style={styles.previewImage} resizeMode="cover" /> : null}
            {selectedCoverName ? <Text style={[styles.uploadedText, dark && styles.uploadedTextDark]}>Selected cover: {selectedCoverName}</Text> : null}
            <TextInput value={mediaForm.title} onChangeText={(title) => setMediaForm((current) => ({ ...current, title }))} placeholder="Title" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
            <TextInput value={mediaForm.externalUrl} onChangeText={(externalUrl) => setMediaForm((current) => ({ ...current, externalUrl }))} placeholder="Optional external video/audio URL" placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.input, dark && styles.inputDark]} />
            {selectedMediaFileName ? <Text style={[styles.uploadedText, dark && styles.uploadedTextDark]}>Selected file: {selectedMediaFileName}</Text> : null}
            {mediaForm.fileUrl ? <Text style={[styles.uploadedText, dark && styles.uploadedTextDark]}>Uploaded file ready</Text> : null}
            {uploadStatus ? <Text style={[styles.statusText, dark && styles.statusTextDark]}>{uploadStatus}</Text> : null}
            <View style={styles.buttonRow}>
              <Pressable onPress={pickMediaFile} disabled={savingMedia} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                <Ionicons name="folder-open-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
                <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>File</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setShowMediaAdvanced((current) => !current)} style={[styles.moreOptions, dark && styles.moreOptionsDark]}>
              <Text style={[styles.moreOptionsText, dark && styles.moreOptionsTextDark]}>{showMediaAdvanced ? 'Hide options' : 'More options'}</Text>
              <Ionicons name={showMediaAdvanced ? 'chevron-up' : 'chevron-down'} size={16} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
            {showMediaAdvanced ? (
              <>
                <TextInput value={mediaForm.speaker} onChangeText={(speaker) => setMediaForm((current) => ({ ...current, speaker }))} placeholder="Speaker / artist" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
                <TextInput value={mediaForm.scriptureReference} onChangeText={(scriptureReference) => setMediaForm((current) => ({ ...current, scriptureReference }))} placeholder="Scripture reference" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
                <TextInput value={mediaForm.description} onChangeText={(description) => setMediaForm((current) => ({ ...current, description }))} placeholder="Description" placeholderTextColor={colors.muted} multiline style={[styles.input, styles.textArea, dark && styles.inputDark]} />
                <Pressable onPress={pickMediaThumbnail} disabled={savingMedia} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                  <Ionicons name="image-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
                  <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Upload Cover</Text>
                </Pressable>
              </>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable onPress={() => setMediaForm((current) => ({ ...current, isFeatured: !current.isFeatured }))} style={[styles.secondaryButton, mediaForm.isFeatured && styles.secondaryButtonActive, dark && styles.secondaryButtonDark]}>
                <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Featured</Text>
              </Pressable>
              <Pressable onPress={() => setMediaForm((current) => ({ ...current, isDownloadable: !current.isDownloadable }))} style={[styles.secondaryButton, mediaForm.isDownloadable && styles.secondaryButtonActive, dark && styles.secondaryButtonDark]}>
                <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Downloadable</Text>
              </Pressable>
              <Pressable onPress={publishMedia} disabled={savingMedia} style={styles.goldButton}>
                <Text style={styles.goldButtonText}>{savingMedia ? 'Publishing...' : 'Publish'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="calendar-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Create Event</Text>
            </View>
            {eventForm.imageUrl ? <Image source={{ uri: eventForm.imageUrl }} style={styles.previewImage} resizeMode="cover" /> : null}
            {selectedEventFlyerName ? <Text style={[styles.uploadedText, dark && styles.uploadedTextDark]}>Selected flyer: {selectedEventFlyerName}</Text> : null}
            <TextInput value={eventForm.title} onChangeText={(title) => setEventForm((current) => ({ ...current, title }))} placeholder="Event title" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
            <TextInput value={eventForm.startsAt} onChangeText={(startsAt) => setEventForm((current) => ({ ...current, startsAt }))} placeholder="Date/time, e.g. 2026-07-01 7:00 PM" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
            <Pressable onPress={() => setShowEventAdvanced((current) => !current)} style={[styles.moreOptions, dark && styles.moreOptionsDark]}>
              <Text style={[styles.moreOptionsText, dark && styles.moreOptionsTextDark]}>{showEventAdvanced ? 'Hide options' : 'More options'}</Text>
              <Ionicons name={showEventAdvanced ? 'chevron-up' : 'chevron-down'} size={16} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
            {showEventAdvanced ? (
              <>
                <TextInput value={eventForm.location} onChangeText={(location) => setEventForm((current) => ({ ...current, location }))} placeholder="Location or livestream" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
                <TextInput value={eventForm.description} onChangeText={(description) => setEventForm((current) => ({ ...current, description }))} placeholder="Event description" placeholderTextColor={colors.muted} multiline style={[styles.input, styles.textArea, dark && styles.inputDark]} />
                <TextInput value={eventForm.registrationUrl} onChangeText={(registrationUrl) => setEventForm((current) => ({ ...current, registrationUrl }))} placeholder="Registration link" placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.input, dark && styles.inputDark]} />
                <Pressable onPress={pickEventFlyer} disabled={savingEvent} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                  <Ionicons name="image-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
                  <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Upload Flyer</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={publishEvent} disabled={savingEvent} style={styles.goldButton}>
              <Text style={styles.goldButtonText}>{savingEvent ? 'Publishing...' : 'Publish Event'}</Text>
            </Pressable>
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Role Management</Text>
            </View>
            <TextInput
              value={roleForm.userId}
              onChangeText={(userId) => setRoleForm((current) => ({ ...current, userId }))}
              placeholder="Supabase user ID"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={[styles.input, dark && styles.inputDark]}
            />
            <View style={styles.kindRow}>
              {roleOptions.map((role) => (
                <Pressable key={role} onPress={() => setRoleForm((current) => ({ ...current, role }))} style={[styles.kindPill, dark && styles.kindPillDark, roleForm.role === role && styles.kindPillActive]}>
                  <Text style={[styles.kindText, dark && styles.kindTextDark, roleForm.role === role && styles.kindTextActive]}>{role.replace('_', ' ')}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.buttonRow}>
              <Pressable onPress={grantRole} disabled={working} style={styles.goldButton}>
                <Text style={styles.goldButtonText}>Grant Role</Text>
              </Pressable>
              <Pressable onPress={() => revokeRole()} disabled={working} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>Revoke</Text>
              </Pressable>
            </View>
            {(workbench?.roles || []).slice(0, 8).map((role) => (
              <View key={`${role.userId}-${role.role}`} style={[styles.listRow, dark && styles.listRowDark]}>
                <View style={styles.listCopy}>
                  <Text style={[styles.listTitle, dark && styles.listTitleDark]}>{role.displayName || role.userId.slice(0, 8)}</Text>
                  <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{role.role.replace('_', ' ')} • {role.userId}</Text>
                </View>
                <Pressable onPress={() => revokeRole(role.userId, role.role)} style={styles.smallDangerButton}>
                  <Text style={styles.smallDangerButtonText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="hand-left-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Prayer Workflow</Text>
            </View>
            <TextInput
              value={prayerAssignee}
              onChangeText={setPrayerAssignee}
              placeholder="Optional assigned user ID"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={[styles.input, dark && styles.inputDark]}
            />
            {(workbench?.prayers || []).slice(0, 6).map((prayer) => (
              <View key={prayer.id} style={[styles.managerCard, dark && styles.managerCardDark]}>
                <Text style={[styles.listTitle, dark && styles.listTitleDark]}>{prayer.name || 'Prayer request'}</Text>
                <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{prayer.category || 'General'} • {prayer.status.replace('_', ' ')}</Text>
                <Text style={[styles.listBody, dark && styles.listBodyDark]} numberOfLines={3}>{prayer.request}</Text>
                <View style={styles.kindRow}>
                  {prayerStatuses.map((status) => (
                    <Pressable key={`${prayer.id}-${status}`} onPress={() => updatePrayer(prayer.id, status)} disabled={working} style={[styles.miniPill, prayer.status === status && styles.miniPillActive]}>
                      <Text style={[styles.miniPillText, prayer.status === status && styles.miniPillTextActive]}>{status.replace('_', ' ')}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="chatbubbles-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Chat Moderation</Text>
            </View>
            {(workbench?.messages || []).slice(0, 8).map((message) => (
              <View key={message.id} style={[styles.listRow, dark && styles.listRowDark]}>
                <View style={styles.listCopy}>
                  <Text style={[styles.listTitle, dark && styles.listTitleDark]}>{message.channelName || 'Chat message'}</Text>
                  <Text style={[styles.listBody, dark && styles.listBodyDark]} numberOfLines={2}>{message.body}</Text>
                  <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{message.isFlagged ? 'Flagged' : 'Visible'} • {message.userId || 'unknown user'}</Text>
                </View>
                <View style={styles.stackedButtons}>
                  <Pressable onPress={() => runAdminAction('Message flagged.', () => moderateMessage(message.id, 'flag'))} style={styles.smallGoldButton}>
                    <Text style={styles.smallGoldButtonText}>Flag</Text>
                  </Pressable>
                  <Pressable onPress={() => runAdminAction('Message removed from chat.', () => moderateMessage(message.id, 'remove'))} style={styles.smallDangerButton}>
                    <Text style={styles.smallDangerButtonText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="checkmark-done-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Approval Queue</Text>
            </View>
            {(workbench?.stories || []).filter((item) => item.status !== 'published').slice(0, 5).map((story) => (
              <View key={story.id} style={[styles.listRow, dark && styles.listRowDark]}>
                <View style={styles.listCopy}>
                  <Text style={[styles.listTitle, dark && styles.listTitleDark]}>{story.title}</Text>
                  <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{story.category || 'story'} • {story.status || 'draft'}</Text>
                </View>
                <Pressable onPress={() => runAdminAction('Story published.', () => setStoryStatus(story.id, 'published'))} style={styles.smallGoldButton}>
                  <Text style={styles.smallGoldButtonText}>Publish</Text>
                </Pressable>
              </View>
            ))}
            {(workbench?.media || []).filter((item) => item.status !== 'published').slice(0, 5).map((item) => (
              <View key={item.id} style={[styles.listRow, dark && styles.listRowDark]}>
                <View style={styles.listCopy}>
                  <Text style={[styles.listTitle, dark && styles.listTitleDark]}>{item.title}</Text>
                  <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{item.mediaType} • {item.status || 'draft'}</Text>
                </View>
                <Pressable onPress={() => runAdminAction('Media published.', () => setMediaStatus(item.id, 'published'))} style={styles.smallGoldButton}>
                  <Text style={styles.smallGoldButtonText}>Publish</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="library-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Media Manager</Text>
            </View>
            {(workbench?.media || []).slice(0, 7).map((item) => (
              <View key={item.id} style={[styles.managerCard, dark && styles.managerCardDark]}>
                <Text style={[styles.listMeta, dark && styles.listMetaDark]}>{item.mediaType} • {item.status || 'draft'}{item.isFeatured ? ' • featured' : ''}</Text>
                <TextInput
                  value={mediaEdit[item.id]?.title ?? item.title}
                  onChangeText={(title) => setMediaEdit((current) => ({ ...current, [item.id]: { title, speaker: current[item.id]?.speaker ?? item.speaker ?? '' } }))}
                  placeholder="Title"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, dark && styles.inputDark]}
                />
                <TextInput
                  value={mediaEdit[item.id]?.speaker ?? item.speaker ?? ''}
                  onChangeText={(speaker) => setMediaEdit((current) => ({ ...current, [item.id]: { title: current[item.id]?.title ?? item.title, speaker } }))}
                  placeholder="Speaker / artist"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, dark && styles.inputDark]}
                />
                <View style={styles.buttonRow}>
                  <Pressable onPress={() => saveMediaEdit(item.id)} style={styles.smallGoldButton}>
                    <Text style={styles.smallGoldButtonText}>Save</Text>
                  </Pressable>
                  <Pressable onPress={() => runAdminAction('Feature status updated.', () => updateMediaRecord(item.id, { isFeatured: !item.isFeatured }))} style={[styles.secondaryButton, dark && styles.secondaryButtonDark]}>
                    <Text style={[styles.secondaryButtonText, dark && styles.secondaryButtonTextDark]}>{item.isFeatured ? 'Unfeature' : 'Feature'}</Text>
                  </Pressable>
                  <Pressable onPress={() => runAdminAction('Media archived.', () => setMediaStatus(item.id, 'archived'))} style={styles.smallDangerButton}>
                    <Text style={styles.smallDangerButtonText}>Archive</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.publishCard, dark && styles.publishCardDark]}>
            <View style={styles.publishHeader}>
              <Ionicons name="notifications-outline" size={22} color={colors.gold} />
              <Text style={[styles.publishTitle, dark && styles.publishTitleDark]}>Notification Composer</Text>
            </View>
            <View style={styles.kindRow}>
              {pushAudiences.map((audience) => (
                <Pressable key={audience} onPress={() => setPushForm((current) => ({ ...current, audience }))} style={[styles.kindPill, dark && styles.kindPillDark, pushForm.audience === audience && styles.kindPillActive]}>
                  <Text style={[styles.kindText, dark && styles.kindTextDark, pushForm.audience === audience && styles.kindTextActive]}>{audience}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={pushForm.title} onChangeText={(title) => setPushForm((current) => ({ ...current, title }))} placeholder="Notification title" placeholderTextColor={colors.muted} style={[styles.input, dark && styles.inputDark]} />
            <TextInput value={pushForm.body} onChangeText={(body) => setPushForm((current) => ({ ...current, body }))} placeholder="Notification message" placeholderTextColor={colors.muted} multiline style={[styles.input, styles.textArea, dark && styles.inputDark]} />
            <Pressable onPress={sendPushNotice} disabled={working} style={styles.goldButton}>
              <Text style={styles.goldButtonText}>{working ? 'Working...' : 'Send Notification'}</Text>
            </Pressable>
          </View>

          <View style={styles.metricGrid}>
            {metrics.map((metric) => (
              <View key={metric.label} style={[styles.metricCard, dark && styles.metricCardDark]}>
                <Ionicons name={metric.icon} size={21} color={colors.gold} />
                <Text style={[styles.metricValue, dark && styles.metricValueDark]}>{metric.value.toLocaleString()}</Text>
                <Text style={[styles.metricLabel, dark && styles.metricLabelDark]}>{metric.label}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>Manage</Text>
          <View style={styles.actionGrid}>
            {actions.map((action) => (
              <Pressable key={action.title} onPress={() => router.push(action.route as any)} style={[styles.actionCard, dark && styles.actionCardDark]}>
                <View style={[styles.actionIcon, dark && styles.actionIconDark]}>
                  <Ionicons name={action.icon} size={23} color={dark ? colors.gold : colors.royalBlue} />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={[styles.actionTitle, dark && styles.actionTitleDark]}>{action.title}</Text>
                  <Text style={[styles.actionSubtitle, dark && styles.actionSubtitleDark]} numberOfLines={2}>{action.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={dark ? 'rgba(255,255,255,0.56)' : colors.deepGold} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

async function pickImageUpload(input: {
  bucketId: string;
  purpose: 'story' | 'media_thumbnail';
  pathPrefix: string;
  relatedTable: string;
  onSelected?: (fileName: string) => void;
}) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photo access needed', 'Allow photo access to upload images.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: input.purpose === 'story' ? ['images', 'videos'] : ['images'],
    allowsEditing: input.purpose !== 'story',
    quality: 0.86,
  });
  if (result.canceled || !result.assets[0]) return null;
  input.onSelected?.(result.assets[0].fileName || 'Selected image');
  return uploadPickedAsset({
    asset: result.assets[0],
    bucketId: input.bucketId,
    purpose: input.purpose,
    pathPrefix: input.pathPrefix,
    relatedTable: input.relatedTable,
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 42 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerCopy: { flex: 1 },
  iconButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.26)', alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  iconButtonDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(212,175,55,0.24)' },
  iconButtonGold: { backgroundColor: colors.gold, borderColor: colors.gold },
  kicker: { color: colors.deepGold, fontWeight: '900', fontSize: 12 },
  kickerDark: { color: colors.gold },
  title: { color: colors.royalBlue, fontSize: 31, lineHeight: 35, fontWeight: '900' },
  titleDark: { color: colors.white },
  body: { color: colors.slate, lineHeight: 21, textAlign: 'center' },
  bodyDark: { color: 'rgba(255,255,255,0.74)' },
  heroCard: { minHeight: 138, borderRadius: 18, borderWidth: 1, borderColor: colors.gold, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, ...shadows.lift },
  heroIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 },
  heroTitle: { color: colors.white, fontSize: 24, fontWeight: '900' },
  heroBody: { color: 'rgba(255,255,255,0.82)', marginTop: 6, lineHeight: 20 },
  commandGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  commandCard: { width: '48.4%', minHeight: 92, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)', padding: 12, justifyContent: 'space-between', ...shadows.soft },
  commandCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  commandIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  commandIconDark: { backgroundColor: 'rgba(212,175,55,0.12)' },
  commandText: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  commandTextDark: { color: colors.white },
  publishCard: { marginTop: 18, borderRadius: 16, padding: 14, gap: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)', ...shadows.soft },
  publishCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  publishHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  publishTitle: { color: colors.royalBlue, fontSize: 18, fontWeight: '900' },
  publishTitleDark: { color: colors.white },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 12, paddingVertical: 11, color: colors.textBody, backgroundColor: '#FAFBFC' },
  inputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.22)', color: colors.white },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  twoColumn: { flexDirection: 'row', gap: 10 },
  halfInput: { flex: 1 },
  previewImage: { width: '100%', height: 128, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)' },
  moreOptions: { minHeight: 42, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreOptionsDark: { backgroundColor: 'rgba(2,8,23,0.3)', borderColor: 'rgba(212,175,55,0.18)' },
  moreOptionsText: { color: colors.royalBlue, fontWeight: '900' },
  moreOptionsTextDark: { color: colors.gold },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, alignItems: 'center' },
  secondaryButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.34)', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.white, flexGrow: 1 },
  secondaryButtonDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  secondaryButtonActive: { backgroundColor: colors.paleGold, borderColor: colors.gold },
  secondaryButtonText: { color: colors.royalBlue, fontWeight: '900' },
  secondaryButtonTextDark: { color: colors.gold },
  goldButton: { minHeight: 44, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexGrow: 1 },
  goldButtonText: { color: '#071231', fontWeight: '900' },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindPill: { borderRadius: 999, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.white },
  kindPillDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.2)' },
  kindPillActive: { backgroundColor: colors.royalBlue, borderColor: colors.gold },
  kindText: { color: colors.royalBlue, fontWeight: '900', textTransform: 'capitalize', fontSize: 12 },
  kindTextDark: { color: 'rgba(255,255,255,0.72)' },
  kindTextActive: { color: colors.gold },
  uploadedText: { color: colors.green, fontWeight: '900' },
  uploadedTextDark: { color: colors.gold },
  statusText: { color: colors.deepGold, fontWeight: '800', lineHeight: 19 },
  statusTextDark: { color: colors.gold },
  managerCard: { borderRadius: 13, borderWidth: 1, borderColor: colors.softLine, backgroundColor: '#FAFBFC', padding: 12, gap: 9 },
  managerCardDark: { borderColor: 'rgba(212,175,55,0.18)', backgroundColor: 'rgba(2,8,23,0.26)' },
  listRow: { minHeight: 70, borderRadius: 13, borderWidth: 1, borderColor: colors.softLine, backgroundColor: '#FAFBFC', padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  listRowDark: { borderColor: 'rgba(212,175,55,0.18)', backgroundColor: 'rgba(2,8,23,0.26)' },
  listCopy: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.royalBlue, fontSize: 15, fontWeight: '900' },
  listTitleDark: { color: colors.white },
  listMeta: { color: colors.slate, fontSize: 12, fontWeight: '800', marginTop: 2 },
  listMetaDark: { color: 'rgba(255,255,255,0.62)' },
  listBody: { color: colors.textBody, fontSize: 12, lineHeight: 17, marginTop: 4 },
  listBodyDark: { color: 'rgba(255,255,255,0.78)' },
  stackedButtons: { gap: 7, alignItems: 'stretch' },
  smallGoldButton: { minHeight: 36, borderRadius: 10, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  smallGoldButtonText: { color: '#071231', fontWeight: '900', fontSize: 12 },
  smallDangerButton: { minHeight: 36, borderRadius: 10, backgroundColor: 'rgba(214,48,49,0.12)', borderWidth: 1, borderColor: 'rgba(214,48,49,0.35)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  smallDangerButtonText: { color: '#D63031', fontWeight: '900', fontSize: 12 },
  miniPill: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(212,175,55,0.34)', paddingHorizontal: 9, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.4)' },
  miniPillActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  miniPillText: { color: colors.royalBlue, fontWeight: '900', fontSize: 12, textTransform: 'capitalize' },
  miniPillTextActive: { color: '#071231' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  metricCard: { width: '31.6%', minHeight: 106, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)', padding: 11, justifyContent: 'center', ...shadows.soft },
  metricCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  metricValue: { color: colors.royalBlue, fontWeight: '900', fontSize: 22, marginTop: 8 },
  metricValueDark: { color: colors.white },
  metricLabel: { color: colors.slate, fontSize: 12, fontWeight: '800', marginTop: 2 },
  metricLabelDark: { color: 'rgba(255,255,255,0.68)' },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 22, marginTop: 24, marginBottom: 12 },
  sectionTitleDark: { color: colors.white },
  actionGrid: { gap: 10 },
  actionCard: { minHeight: 78, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, flexDirection: 'row', alignItems: 'center', padding: 13, gap: 12, ...shadows.soft },
  actionCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.18)' },
  actionIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  actionIconDark: { backgroundColor: 'rgba(212,175,55,0.12)' },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: { color: colors.royalBlue, fontSize: 17, fontWeight: '900' },
  actionTitleDark: { color: colors.white },
  actionSubtitle: { color: colors.slate, lineHeight: 18, marginTop: 2, fontSize: 12 },
  actionSubtitleDark: { color: 'rgba(255,255,255,0.66)' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 8 },
  primaryButtonDark: { backgroundColor: colors.gold },
  primaryButtonText: { color: colors.white, fontWeight: '900' },
  primaryButtonTextDark: { color: '#071231' },
});
