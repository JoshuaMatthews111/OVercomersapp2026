// Admin, the WhatsApp way. One home with five big rows. Each row opens one
// simple page that does one job. No wall of forms.
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AdminWorkbench,
  deleteStory,
  getAdminWorkbench,
  grantUserRole,
  moderateMessage,
  PushAudience,
  revokeUserRole,
  sendAdminPush,
  setMediaStatus,
  setStoryStatus,
  updateMediaRecord,
  updatePrayerWorkflow,
} from '../lib/adminManagementService';
import { useAccessProfile } from '../lib/accessControl';
import { ChatProfileSearchResult, searchChatProfiles } from '../lib/chatService';
import { createAdminEvent, createAdminMediaItem, createAdminStory } from '../lib/contentService';
import { embedUrl } from '../lib/embed';
import { friendlyError } from '../lib/errorMessages';
import { colors, shadows } from '../lib/theme';
import { useThemePreference } from '../lib/themePreference';
import { uploadDocumentAsset, uploadPickedAsset } from '../lib/uploadService';
import { AppRole, MediaKind } from '../types/models';

type Page = 'home' | 'review' | 'post' | 'people' | 'notice' | 'library';
type PostKind = 'story' | 'media' | 'event' | null;

// The four switches a person can have. Everything else stays under the hood.
const PEOPLE_SWITCHES: { role: AppRole; label: string; hint: string }[] = [
  { role: 'admin', label: 'Admin', hint: 'Can do everything here' },
  { role: 'moderator', label: 'Moderator', hint: 'Can remove chat messages' },
  { role: 'media_admin', label: 'Can post media', hint: 'Sermons, videos, music' },
  { role: 'prayer_team', label: 'Prayer team', hint: 'Sees prayer requests' },
];

const AUDIENCES: { key: PushAudience; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'prayer', label: 'Prayer' },
  { key: 'sermons', label: 'Sermons' },
];

const MEDIA_KINDS: { key: MediaKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'sermon', label: 'Sermon', icon: 'mic' },
  { key: 'video', label: 'Video', icon: 'videocam' },
  { key: 'music', label: 'Music', icon: 'musical-notes' },
  { key: 'article', label: 'Article', icon: 'document-text' },
];

export default function AdminScreen() {
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [page, setPage] = useState<Page>('home');
  const [workbench, setWorkbench] = useState<AdminWorkbench | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setWorkbench(await getAdminWorkbench()); } catch { /* keep what we have */ }
  }
  useEffect(() => { refresh(); }, []);

  async function run(done: string, action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
      if (done) Alert.alert(done);
    } catch (err) {
      Alert.alert('That did not work', friendlyError(err, 'Check your permissions and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const heldMessages = (workbench?.messages || []).filter((m) => m.isFlagged);
  const waitingStories = (workbench?.stories || []).filter((s) => s.status !== 'published');
  const newPrayers = (workbench?.prayers || []).filter((p) => p.status === 'new');
  const reviewCount = heldMessages.length + waitingStories.length + newPrayers.length;

  if (!access.canManageContent && !access.canModerateChat) {
    return (
      <Shell dark={dark} title="Admin" onBack={() => router.back()}>
        <Empty dark={dark} icon="lock-closed-outline" title="Admins only" body="Ask an OGN admin to switch on Admin for your account." />
      </Shell>
    );
  }

  const titles: Record<Page, string> = { home: 'Admin', review: 'Needs your look', post: 'Post something', people: 'People', notice: 'Send a notice', library: 'Library' };

  return (
    <Shell dark={dark} title={titles[page]} onBack={() => (page === 'home' ? router.back() : setPage('home'))} busy={busy}>
      {page === 'home' ? (
        <View style={styles.rows}>
          <Row dark={dark} icon="eye-outline" tint="#E0457B" title="Needs your look" sub={reviewCount ? `${reviewCount} waiting` : 'All clear'} badge={reviewCount} onPress={() => setPage('review')} />
          <Row dark={dark} icon="add-circle-outline" tint={colors.gold} title="Post something" sub="Story, sermon, video, music, event" onPress={() => setPage('post')} />
          <Row dark={dark} icon="people-outline" tint="#3C7DFF" title="People" sub="Make someone an admin or moderator" onPress={() => setPage('people')} />
          <Row dark={dark} icon="megaphone-outline" tint="#FF7A00" title="Send a notice" sub="Push a message to phones" onPress={() => setPage('notice')} />
          <Row dark={dark} icon="albums-outline" tint="#7C4DFF" title="Library" sub="Feature, hide, or delete what is live" onPress={() => setPage('library')} />
        </View>
      ) : null}

      {page === 'review' ? (
        <View style={styles.rows}>
          {!reviewCount ? <Empty dark={dark} icon="checkmark-circle-outline" title="All clear" body="Nothing is waiting for you." /> : null}
          {heldMessages.length ? <Label dark={dark} text="Held chat messages" /> : null}
          {heldMessages.map((m) => (
            <Card key={m.id} dark={dark}>
              <Text style={[styles.cardTitle, dark && styles.textDark]}>{m.channelName || 'Chat'}</Text>
              <Text style={[styles.cardBody, dark && styles.textDimDark]}>{m.body || '(attachment only)'}</Text>
              <View style={styles.actions}>
                <Btn label="Approve" onPress={() => run('', () => moderateMessage(m.id, 'approve'))} />
                <Btn label="Remove" danger onPress={() => run('', () => moderateMessage(m.id, 'remove'))} />
              </View>
            </Card>
          ))}
          {waitingStories.length ? <Label dark={dark} text="Stories waiting" /> : null}
          {waitingStories.map((s) => (
            <Card key={s.id} dark={dark}>
              <Text style={[styles.cardTitle, dark && styles.textDark]}>{s.title}</Text>
              <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{s.category || 'Story'} • {s.status || 'draft'}</Text>
              <View style={styles.actions}>
                <Btn label="Publish" onPress={() => run('', () => setStoryStatus(s.id, 'published'))} />
                <Btn label="Delete" danger onPress={() => confirmDelete(`"${s.title}"`, () => run('', () => deleteStory(s.id)))} />
              </View>
            </Card>
          ))}
          {newPrayers.length ? <Label dark={dark} text="New prayer requests" /> : null}
          {newPrayers.map((p) => (
            <Card key={p.id} dark={dark}>
              <Text style={[styles.cardTitle, dark && styles.textDark]}>{p.name || 'Someone'}{p.category ? ` • ${p.category}` : ''}</Text>
              <Text style={[styles.cardBody, dark && styles.textDimDark]}>{p.request}</Text>
              <View style={styles.actions}>
                <Btn label="We are praying" onPress={() => run('', () => updatePrayerWorkflow({ id: p.id, status: 'praying' }))} />
                <Btn label="Answered" onPress={() => run('', () => updatePrayerWorkflow({ id: p.id, status: 'answered' }))} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {page === 'post' ? <PostPage dark={dark} onDone={refresh} /> : null}
      {page === 'people' ? <PeoplePage dark={dark} workbench={workbench} run={run} /> : null}
      {page === 'notice' ? <NoticePage dark={dark} /> : null}
      {page === 'library' ? <LibraryPage dark={dark} workbench={workbench} run={run} /> : null}
    </Shell>
  );
}

function confirmDelete(what: string, onYes: () => void) {
  Alert.alert('Delete?', `${what} will be removed for everyone.`, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ]);
}

// ---------- Post something ----------

function PostPage({ dark, onDone }: { dark: boolean; onDone: () => Promise<void> }) {
  const [kind, setKind] = useState<PostKind>(null);
  if (!kind) {
    return (
      <View style={styles.tiles}>
        <Tile dark={dark} icon="images" tint="#E0457B" label="Story" hint="Photo or video, gone in 24h" onPress={() => setKind('story')} />
        <Tile dark={dark} icon="play-circle" tint={colors.gold} label="Sermon or media" hint="Paste a link or upload" onPress={() => setKind('media')} />
        <Tile dark={dark} icon="calendar" tint="#3C7DFF" label="Event" hint="Date, place, flyer" onPress={() => setKind('event')} />
      </View>
    );
  }
  if (kind === 'story') return <StoryForm dark={dark} onDone={async () => { await onDone(); setKind(null); }} />;
  if (kind === 'media') return <MediaForm dark={dark} onDone={async () => { await onDone(); setKind(null); }} />;
  return <EventForm dark={dark} onDone={async () => { await onDone(); setKind(null); }} />;
}

function StoryForm({ dark, onDone }: { dark: boolean; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function pickMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.86 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setSaving(true);
    try {
      const upload = await uploadPickedAsset({ asset, bucketId: 'story-media', purpose: 'story', pathPrefix: 'stories', relatedTable: 'app_stories' });
      setMedia({ url: upload.publicUrl, isVideo: asset.type === 'video' });
    } catch (err) {
      Alert.alert('Upload failed', friendlyError(err, 'Try another photo or video.'));
    } finally {
      setSaving(false);
    }
  }

  async function post() {
    if (!media) return Alert.alert('Pick a photo or video first');
    if (!title.trim()) return Alert.alert('Give the story a short title');
    setSaving(true);
    try {
      await createAdminStory({ title: title.trim(), body: caption.trim() || undefined, imageUrl: media.url });
      Alert.alert('Story posted', 'It is live on Home for 24 hours.');
      await onDone();
    } catch (err) {
      Alert.alert('Not posted', friendlyError(err, 'Check your permissions and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Pressable accessibilityRole="button" accessibilityLabel="Pick a photo or video" onPress={pickMedia} style={[styles.dropzone, dark && styles.dropzoneDark]}>
        {media && !media.isVideo ? <Image source={{ uri: media.url }} contentFit="cover" style={styles.dropzoneImage} /> : (
          <>
            <Ionicons name={media?.isVideo ? 'videocam' : 'camera-outline'} size={34} color={colors.gold} />
            <Text style={[styles.dropzoneText, dark && styles.textDark]}>{media?.isVideo ? 'Video ready' : 'Tap to pick a photo or video'}</Text>
          </>
        )}
      </Pressable>
      <Field dark={dark} value={title} onChange={setTitle} placeholder="Title (short)" />
      <Field dark={dark} value={caption} onChange={setCaption} placeholder="Caption (optional)" multiline />
      <Big label={saving ? 'Working...' : 'Post story'} disabled={saving} onPress={post} />
    </View>
  );
}

function MediaForm({ dark, onDone }: { dark: boolean; onDone: () => Promise<void> }) {
  const [kind, setKind] = useState<MediaKind>('sermon');
  const [title, setTitle] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [link, setLink] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [cover, setCover] = useState('');
  const [featured, setFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const linkOk = useMemo(() => !link.trim() || Boolean(embedUrl(link.trim())) || /\.(mp3|mp4|m4a|m3u8|mov|pdf)(\?|$)/i.test(link.trim()), [link]);

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setSaving(true);
    try {
      const upload = await uploadDocumentAsset({ asset, bucketId: 'app-assets', purpose: 'media_file', pathPrefix: 'media-files', relatedTable: 'media_items' });
      setFileUrl(upload.publicUrl);
      setFileName(upload.fileName);
    } catch (err) {
      Alert.alert('Upload failed', friendlyError(err, 'Try another file.'));
    } finally {
      setSaving(false);
    }
  }

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.86 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setSaving(true);
    try {
      const upload = await uploadPickedAsset({ asset, bucketId: 'app-assets', purpose: 'media_thumbnail', pathPrefix: 'media-thumbnails', relatedTable: 'media_items' });
      setCover(upload.publicUrl);
    } catch (err) {
      Alert.alert('Upload failed', friendlyError(err, 'Try another image.'));
    } finally {
      setSaving(false);
    }
  }

  async function post() {
    if (!title.trim()) return Alert.alert('Give it a title');
    if (!link.trim() && !fileUrl) return Alert.alert('Paste a link or upload a file');
    if (!linkOk) return Alert.alert('Link not recognized', 'Use a YouTube, Vimeo, or Facebook video link, or a direct mp3 / mp4 file.');
    setSaving(true);
    try {
      await createAdminMediaItem({ mediaType: kind, title: title.trim(), speaker: speaker.trim() || undefined, thumbnailUrl: cover || undefined, fileUrl: fileUrl || undefined, externalUrl: link.trim() || undefined, isDownloadable: Boolean(fileUrl), isFeatured: featured });
      Alert.alert('Posted', 'It is live in the Media tab.');
      await onDone();
    } catch (err) {
      Alert.alert('Not posted', friendlyError(err, 'Check your permissions and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {MEDIA_KINDS.map((k) => (
          <Pressable key={k.key} accessibilityRole="button" accessibilityState={{ selected: kind === k.key }} onPress={() => setKind(k.key)} style={[styles.chip, dark && styles.chipDark, kind === k.key && styles.chipOn]}>
            <Ionicons name={k.icon} size={16} color={kind === k.key ? '#071231' : dark ? colors.gold : colors.royalBlue} />
            <Text style={[styles.chipText, dark && styles.textDark, kind === k.key && styles.chipTextOn]}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field dark={dark} value={title} onChange={setTitle} placeholder="Title" />
      <Field dark={dark} value={speaker} onChange={setSpeaker} placeholder="Speaker or artist (optional)" />
      <Field dark={dark} value={link} onChange={setLink} placeholder="Paste a YouTube, Vimeo, or Facebook link" autoCapitalize="none" />
      {!linkOk ? <Text style={styles.warn}>That link will not play. Use YouTube, Vimeo, Facebook, or a direct mp3 / mp4.</Text> : null}
      <Text style={[styles.or, dark && styles.textDimDark]}>or</Text>
      <Pressable accessibilityRole="button" onPress={pickFile} style={[styles.dropzoneSmall, dark && styles.dropzoneDark]}>
        <Ionicons name="cloud-upload-outline" size={22} color={colors.gold} />
        <Text style={[styles.dropzoneText, dark && styles.textDark]}>{fileName ? `File ready: ${fileName}` : 'Upload an mp3, mp4, or PDF'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={pickCover} style={[styles.dropzoneSmall, dark && styles.dropzoneDark]}>
        {cover ? <Image source={{ uri: cover }} contentFit="cover" style={styles.coverThumb} /> : <Ionicons name="image-outline" size={22} color={colors.gold} />}
        <Text style={[styles.dropzoneText, dark && styles.textDark]}>{cover ? 'Cover ready' : 'Cover image (optional)'}</Text>
      </Pressable>
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, dark && styles.textDark]}>Feature on the Media tab</Text>
        <Switch value={featured} onValueChange={setFeatured} trackColor={{ true: colors.gold }} />
      </View>
      <Big label={saving ? 'Working...' : 'Post'} disabled={saving} onPress={post} />
    </View>
  );
}

function EventForm({ dark, onDone }: { dark: boolean; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [link, setLink] = useState('');
  const [flyer, setFlyer] = useState('');
  const [saving, setSaving] = useState(false);

  async function pickFlyer() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setSaving(true);
    try {
      const upload = await uploadPickedAsset({ asset, bucketId: 'app-assets', purpose: 'media_thumbnail', pathPrefix: 'event-flyers', relatedTable: 'events' });
      setFlyer(upload.publicUrl);
    } catch (err) {
      Alert.alert('Upload failed', friendlyError(err, 'Try another image.'));
    } finally {
      setSaving(false);
    }
  }

  async function post() {
    if (!title.trim()) return Alert.alert('Give the event a title');
    const parsed = new Date(when.trim());
    if (!when.trim() || Number.isNaN(parsed.getTime())) return Alert.alert('When?', 'Type a date and time like 2026-10-05 7:00 PM.');
    setSaving(true);
    try {
      await createAdminEvent({ title: title.trim(), startsAt: parsed.toISOString(), location: where.trim() || undefined, imageUrl: flyer || undefined, registrationUrl: link.trim() || undefined });
      Alert.alert('Event posted', 'It is live on Home.');
      await onDone();
    } catch (err) {
      Alert.alert('Not posted', friendlyError(err, 'Check your permissions and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Pressable accessibilityRole="button" accessibilityLabel="Pick a flyer" onPress={pickFlyer} style={[styles.dropzone, dark && styles.dropzoneDark]}>
        {flyer ? <Image source={{ uri: flyer }} contentFit="cover" style={styles.dropzoneImage} /> : (
          <>
            <Ionicons name="image-outline" size={34} color={colors.gold} />
            <Text style={[styles.dropzoneText, dark && styles.textDark]}>Tap to add a flyer (optional)</Text>
          </>
        )}
      </Pressable>
      <Field dark={dark} value={title} onChange={setTitle} placeholder="Event title" />
      <Field dark={dark} value={when} onChange={setWhen} placeholder="When, like 2026-10-05 7:00 PM" />
      <Field dark={dark} value={where} onChange={setWhere} placeholder="Where (optional)" />
      <Field dark={dark} value={link} onChange={setLink} placeholder="Watch or register link (optional)" autoCapitalize="none" />
      <Big label={saving ? 'Working...' : 'Post event'} disabled={saving} onPress={post} />
    </View>
  );
}

// ---------- People ----------

function PeoplePage({ dark, workbench, run }: { dark: boolean; workbench: AdminWorkbench | null; run: (done: string, action: () => Promise<unknown>) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatProfileSearchResult[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    searchChatProfiles(query).then((rows) => { if (alive) setResults(rows); }).catch(() => undefined);
    return () => { alive = false; };
  }, [query]);

  const rolesOf = (userId: string) => new Set((workbench?.roles || []).filter((r) => r.userId === userId).map((r) => r.role));
  const staff = useMemo(() => {
    const byUser = new Map<string, { name?: string; roles: AppRole[] }>();
    for (const r of workbench?.roles || []) {
      if (r.role === 'member' || r.role === 'visitor') continue;
      const entry = byUser.get(r.userId) || { name: r.displayName, roles: [] };
      entry.roles.push(r.role);
      byUser.set(r.userId, entry);
    }
    return Array.from(byUser.entries());
  }, [workbench]);

  const target = picked;
  return (
    <View style={styles.rows}>
      <Field dark={dark} value={query} onChange={(v) => { setQuery(v); setPicked(null); }} placeholder="Search a name or phone" />
      {!target && results.slice(0, 6).map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => setPicked({ id: r.id, name: r.displayName })} style={[styles.person, dark && styles.cardDark]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(r.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, dark && styles.textDark]}>{r.displayName}</Text>
            {r.phone ? <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{r.phone}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={dark ? colors.gold : colors.slate} />
        </Pressable>
      ))}
      {target ? (
        <Card dark={dark}>
          <Text style={[styles.cardTitle, dark && styles.textDark]}>{target.name}</Text>
          {PEOPLE_SWITCHES.map((sw) => {
            const on = rolesOf(target.id).has(sw.role);
            return (
              <View key={sw.role} style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switchLabel, dark && styles.textDark]}>{sw.label}</Text>
                  <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{sw.hint}</Text>
                </View>
                <Switch value={on} onValueChange={(next) => run('', () => (next ? grantUserRole(target.id, sw.role) : revokeUserRole(target.id, sw.role)))} trackColor={{ true: colors.gold }} />
              </View>
            );
          })}
        </Card>
      ) : null}
      {!target && !query ? <Label dark={dark} text="People with a role" /> : null}
      {!target && !query && staff.map(([userId, entry]) => (
        <Pressable key={userId} accessibilityRole="button" onPress={() => setPicked({ id: userId, name: entry.name || 'Member' })} style={[styles.person, dark && styles.cardDark]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(entry.name || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, dark && styles.textDark]}>{entry.name || 'Member'}</Text>
            <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{entry.roles.map((r) => PEOPLE_SWITCHES.find((s) => s.role === r)?.label || r).join(' • ')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={dark ? colors.gold : colors.slate} />
        </Pressable>
      ))}
    </View>
  );
}

// ---------- Send a notice ----------

function NoticePage({ dark }: { dark: boolean }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<PushAudience>('all');
  const [sending, setSending] = useState(false);

  function send() {
    if (!title.trim() || !body.trim()) return Alert.alert('Write a title and a message');
    const who = AUDIENCES.find((a) => a.key === audience)?.label || 'Everyone';
    Alert.alert(`Send to ${who}?`, `${title.trim()}\n\n${body.trim()}`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setSending(true);
        try {
          await sendAdminPush({ title: title.trim(), body: body.trim(), audience });
          setTitle(''); setBody('');
          Alert.alert('Sent');
        } catch (err) {
          Alert.alert('Not sent', friendlyError(err, 'Please try again.'));
        } finally {
          setSending(false);
        }
      } },
    ]);
  }

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {AUDIENCES.map((a) => (
          <Pressable key={a.key} accessibilityRole="button" accessibilityState={{ selected: audience === a.key }} onPress={() => setAudience(a.key)} style={[styles.chip, dark && styles.chipDark, audience === a.key && styles.chipOn]}>
            <Text style={[styles.chipText, dark && styles.textDark, audience === a.key && styles.chipTextOn]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field dark={dark} value={title} onChange={setTitle} placeholder="Title" />
      <Field dark={dark} value={body} onChange={setBody} placeholder="Message" multiline />
      <Big label={sending ? 'Sending...' : 'Send notice'} disabled={sending} onPress={send} />
    </View>
  );
}

// ---------- Library ----------

function LibraryPage({ dark, workbench, run }: { dark: boolean; workbench: AdminWorkbench | null; run: (done: string, action: () => Promise<unknown>) => Promise<void> }) {
  const live = (workbench?.media || []).filter((m) => m.status === 'published');
  const stories = (workbench?.stories || []).filter((s) => s.status === 'published');
  return (
    <View style={styles.rows}>
      {stories.length ? <Label dark={dark} text="Live stories" /> : null}
      {stories.map((s) => (
        <Card key={s.id} dark={dark}>
          <Text style={[styles.cardTitle, dark && styles.textDark]}>{s.title}</Text>
          <View style={styles.actions}>
            <Btn label="Delete" danger onPress={() => confirmDelete(`"${s.title}"`, () => run('', () => deleteStory(s.id)))} />
          </View>
        </Card>
      ))}
      <Label dark={dark} text="Live media" />
      {!live.length ? <Empty dark={dark} icon="albums-outline" title="Nothing live yet" body="Post a sermon, video, or song from Post something." /> : null}
      {live.map((m) => (
        <Card key={m.id} dark={dark}>
          <Text style={[styles.cardTitle, dark && styles.textDark]}>{m.title}</Text>
          <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{m.mediaType}{m.speaker ? ` • ${m.speaker}` : ''}{m.isFeatured ? ' • Featured' : ''}</Text>
          <View style={styles.actions}>
            <Btn label={m.isFeatured ? 'Unfeature' : 'Feature'} onPress={() => run('', () => updateMediaRecord(m.id, { isFeatured: !m.isFeatured }))} />
            <Btn label="Hide" danger onPress={() => run('', () => setMediaStatus(m.id, 'archived'))} />
          </View>
        </Card>
      ))}
    </View>
  );
}

// ---------- Small pieces ----------

function Shell({ dark, title, onBack, busy, children }: { dark: boolean; title: string; onBack: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#F8FBFF', '#FFFFFF', '#F4F8FF']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={10} style={[styles.back, dark && styles.backDark]}>
            <Ionicons name="chevron-back" size={24} color={dark ? colors.gold : colors.royalBlue} />
          </Pressable>
          <Text style={[styles.title, dark && styles.textDark]}>{title}</Text>
          {busy ? <ActivityIndicator color={colors.gold} /> : <View style={{ width: 24 }} />}
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Row({ dark, icon, tint, title, sub, badge, onPress }: { dark: boolean; icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; sub: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[styles.row, dark && styles.cardDark]}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}><Ionicons name={icon} size={24} color={colors.white} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, dark && styles.textDark]}>{title}</Text>
        <Text style={[styles.cardMeta, dark && styles.textDimDark]}>{sub}</Text>
      </View>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      <Ionicons name="chevron-forward" size={20} color={dark ? colors.gold : colors.slate} />
    </Pressable>
  );
}

function Tile({ dark, icon, tint, label, hint, onPress }: { dark: boolean; icon: keyof typeof Ionicons.glyphMap; tint: string; label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.tile, dark && styles.cardDark]}>
      <View style={[styles.tileIcon, { backgroundColor: tint }]}><Ionicons name={icon} size={30} color={colors.white} /></View>
      <Text style={[styles.rowTitle, dark && styles.textDark]}>{label}</Text>
      <Text style={[styles.cardMeta, dark && styles.textDimDark, { textAlign: 'center' }]}>{hint}</Text>
    </Pressable>
  );
}

function Card({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return <View style={[styles.card, dark && styles.cardDark]}>{children}</View>;
}

function Label({ dark, text }: { dark: boolean; text: string }) {
  return <Text style={[styles.label, dark && styles.textDimDark]}>{text}</Text>;
}

function Empty({ dark, icon, title, body }: { dark: boolean; icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={colors.gold} />
      <Text style={[styles.rowTitle, dark && styles.textDark]}>{title}</Text>
      <Text style={[styles.cardMeta, dark && styles.textDimDark, { textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}

function Btn({ label, danger, onPress }: { label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.btn, danger && styles.btnDanger]}>
      <Text style={[styles.btnText, danger && styles.btnTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function Big({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.big, disabled && { opacity: 0.6 }]}>
      <Text style={styles.bigText}>{label}</Text>
    </Pressable>
  );
}

function Field({ dark, value, onChange, placeholder, multiline, autoCapitalize }: { dark: boolean; value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={dark ? 'rgba(255,255,255,0.45)' : colors.muted}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      style={[styles.field, dark && styles.fieldDark, multiline && { minHeight: 92, textAlignVertical: 'top' }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, ...shadows.soft },
  backDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  title: { flex: 1, color: colors.royalBlue, fontSize: 24, fontWeight: '900' },
  scroll: { padding: 16, paddingBottom: 60 },
  rows: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, backgroundColor: colors.white, ...shadows.soft },
  rowIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.royalBlue, fontSize: 17, fontWeight: '900' },
  badge: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 8, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontWeight: '900', fontSize: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.white, ...shadows.soft },
  tileIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 14, borderRadius: 16, backgroundColor: colors.white, gap: 6, ...shadows.soft },
  cardDark: { backgroundColor: 'rgba(255,255,255,0.06)' },
  cardTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  cardBody: { color: colors.textBody, lineHeight: 20 },
  cardMeta: { color: colors.slate, fontSize: 12, marginTop: 2 },
  label: { color: colors.slate, fontWeight: '800', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  btnDanger: { backgroundColor: 'rgba(220,38,38,0.1)' },
  btnText: { color: '#071231', fontWeight: '900' },
  btnTextDanger: { color: colors.red },
  big: { minHeight: 54, borderRadius: 16, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  bigText: { color: '#071231', fontWeight: '900', fontSize: 16 },
  form: { gap: 12 },
  field: { minHeight: 50, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.white, color: colors.royalBlue, fontSize: 15, borderWidth: 1, borderColor: colors.softLine },
  fieldDark: { backgroundColor: 'rgba(255,255,255,0.07)', color: colors.white, borderColor: 'rgba(212,175,55,0.24)' },
  dropzone: { height: 190, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(212,175,55,0.6)', backgroundColor: 'rgba(212,175,55,0.08)', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden' },
  dropzoneSmall: { minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(212,175,55,0.6)', backgroundColor: 'rgba(212,175,55,0.08)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  dropzoneDark: { backgroundColor: 'rgba(212,175,55,0.1)' },
  dropzoneImage: { width: '100%', height: '100%' },
  dropzoneText: { color: colors.royalBlue, fontWeight: '800', flexShrink: 1 },
  coverThumb: { width: 34, height: 34, borderRadius: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(212,175,55,0.24)' },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.royalBlue, fontWeight: '800' },
  chipTextOn: { color: '#071231' },
  or: { textAlign: 'center', color: colors.slate, fontWeight: '800' },
  warn: { color: colors.red, fontSize: 12, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  switchLabel: { color: colors.royalBlue, fontWeight: '800', fontSize: 15 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.white, ...shadows.soft },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#071231', fontWeight: '900', fontSize: 16 },
  empty: { alignItems: 'center', gap: 8, padding: 28 },
  textDark: { color: colors.white },
  textDimDark: { color: 'rgba(255,255,255,0.68)' },
});
