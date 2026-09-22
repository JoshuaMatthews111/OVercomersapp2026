// Add or change an event (owner's list, 2026-09-22): "Events ... publish from
// admin ... with event photo and message attached or description; admin can
// create and manage events on Home Screen."
//
// Reached from Admin > Post something > Event, from Home ("+ Event"), and from
// the Manage events list (?id= to change one). Leaders only: the screen checks
// canManageContent itself, and the database refuses everyone else.
//
// No typed dates. The old form asked for "2026-10-05 7:00 PM" in a text box,
// which is how services get posted for the wrong day. The day and the times
// are stepped with big buttons instead, and the words underneath always say
// exactly what will be saved.
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../../components/Card';
import { useAccessProfile } from '../../lib/accessControl';
import { friendlyError } from '../../lib/errorMessages';
import {
  ChurchEvent,
  EventDraft,
  EventRecurrence,
  addLocalDays,
  deleteEvent,
  draftProblem,
  getEventById,
  occurrenceAtOrAfter,
  saveEvent,
  setEventStatus,
  timeText,
  uploadEventPhoto,
  weekdayName,
} from '../../lib/eventsService';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { friendlyUploadError } from '../../lib/uploadService';

const MINUTE = 60 * 1000;

/** The coming Sunday at 10:00 AM — only a starting point; the leader changes it. */
function nextSundayMorning(now = new Date()): Date {
  const at = new Date(now.getTime());
  at.setHours(10, 0, 0, 0);
  while (at.getDay() !== 0 || at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

function fullDayText(date: Date): string {
  return date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

type Form = {
  title: string;
  description: string;
  location: string;
  locationUrl: string;
  registrationUrl: string;
  imageUrl: string;
  start: Date;
  end: Date;
  recurrence: EventRecurrence;
  published: boolean;
};

function blankForm(): Form {
  const start = nextSundayMorning();
  return {
    title: '',
    description: '',
    location: '',
    locationUrl: '',
    registrationUrl: '',
    imageUrl: '',
    start,
    end: new Date(start.getTime() + 120 * MINUTE),
    recurrence: 'none',
    published: true,
  };
}

function formFromEvent(event: ChurchEvent): Form {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 120 * MINUTE);
  return {
    title: event.title,
    description: event.description || '',
    location: event.location || '',
    locationUrl: event.locationUrl || '',
    registrationUrl: event.registrationUrl || '',
    imageUrl: event.imageUrl || '',
    start,
    end: end.getTime() > start.getTime() ? end : new Date(start.getTime() + 120 * MINUTE),
    recurrence: event.recurrence,
    published: event.published,
  };
}

function draftOf(form: Form): EventDraft {
  return {
    title: form.title,
    description: form.description,
    location: form.location,
    locationUrl: form.locationUrl,
    registrationUrl: form.registrationUrl,
    imageUrl: form.imageUrl,
    startsAt: form.start,
    endsAt: form.end,
    recurrence: form.recurrence,
    published: form.published,
  };
}

export default function EventEditorScreen() {
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' && params.id ? params.id : undefined;

  const [form, setForm] = useState<Form>(blankForm);
  const [status, setStatus] = useState<ChurchEvent['status']>('scheduled');
  const [loading, setLoading] = useState(Boolean(editingId));
  const [loadError, setLoadError] = useState('');
  const [transfer, setTransfer] = useState<{ label: string; fraction: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ChurchEvent | null>(null);
  const [problem, setProblem] = useState('');
  const [pulling, setPulling] = useState(false);
  /** True once the leader has changed anything. A reload must never throw that away. */
  const dirty = useRef(false);
  const working = saving || Boolean(transfer);
  const canManage = !loadingAccess && access.canManageContent;

  const load = useCallback(async () => {
    if (!editingId) return;
    setLoadError('');
    try {
      const found = await getEventById(editingId);
      if (!found) {
        setLoadError('We could not find that event. It may have been deleted.');
        return;
      }
      if (dirty.current) return;
      setForm(formFromEvent(found));
      setStatus(found.status);
    } catch (err) {
      setLoadError(friendlyError(err, 'We could not open this event just now. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [editingId]);

  // Opening it, or coming back to it, shows the event as it is saved now —
  // unless the leader has already started changing it here.
  useFocusEffect(
    useCallback(() => {
      if (canManage && !dirty.current) void load();
    }, [canManage, load]),
  );

  async function pullToRefresh() {
    setPulling(true);
    try {
      await load();
    } finally {
      setPulling(false);
    }
  }

  function update(patch: Partial<Form>) {
    dirty.current = true;
    setProblem('');
    setForm((current) => ({ ...current, ...patch }));
  }

  /** Moving the start carries the end with it, so the length stays the same. */
  function moveStart(next: Date) {
    dirty.current = true;
    setProblem('');
    setForm((current) => {
      const length = Math.max(15 * MINUTE, current.end.getTime() - current.start.getTime());
      return { ...current, start: next, end: new Date(next.getTime() + length) };
    });
  }

  function moveEnd(next: Date) {
    dirty.current = true;
    setProblem('');
    setForm((current) => ({ ...current, end: next.getTime() > current.start.getTime() ? next : new Date(current.start.getTime() + 15 * MINUTE) }));
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/events' as any);
  }

  async function pickPhoto() {
    if (working) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const label = asset.fileName || 'Event photo';
    setTransfer({ label, fraction: 0 });
    try {
      const url = await uploadEventPhoto(asset, (fraction) => setTransfer({ label, fraction }));
      update({ imageUrl: url });
    } catch (err) {
      Alert.alert('The photo did not upload', friendlyUploadError(err, 'Try another picture, or save the event without one.'));
    } finally {
      setTransfer(null);
    }
  }

  async function save() {
    if (working) return;
    const draft = draftOf(form);
    const wrong = draftProblem(draft);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setSaving(true);
    try {
      const result = await saveEvent(draft, editingId);
      dirty.current = false;
      setSaved(result);
    } catch (err) {
      setProblem(friendlyError(err, 'The event was not saved. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  function toggleCancelled() {
    if (!editingId || working) return;
    const cancelling = status !== 'cancelled';
    Alert.alert(
      cancelling ? 'Cancel this event?' : 'Bring this event back?',
      cancelling
        ? `${form.recurrence === 'weekly'
            ? 'This calls off EVERY week until you bring it back. To call off just one week, keep it as it is and send a message to the groups instead. '
            : ''}It stays on Home marked "Cancelled", so anyone planning to come knows. Reminders people set stop the next time they open the app. Nobody gets a message about it: use "Send to chat groups" on the event to tell them.`
        : 'It goes back on Home as normal.',
      [
        { text: 'Keep it as it is', style: 'cancel' },
        {
          text: cancelling ? 'Cancel the event' : 'Bring it back',
          style: cancelling ? 'destructive' : 'default',
          onPress: async () => {
            setSaving(true);
            try {
              const next = await setEventStatus(editingId, cancelling ? 'cancelled' : 'scheduled');
              setStatus(next.status);
            } catch (err) {
              Alert.alert('That did not work', friendlyError(err, 'Please check your connection and try again.'));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  function confirmDelete() {
    if (!editingId || working) return;
    Alert.alert('Delete this event?', 'It is removed for everyone, along with any attendance logged under it. This cannot be undone. To keep the attendance, cancel it instead.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await deleteEvent(editingId);
            router.replace('/events' as any);
          } catch (err) {
            Alert.alert('That did not work', friendlyError(err, 'Please check your connection and try again.'));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
      </Pressable>
      <View style={styles.grow}>
        <Text style={styles.title}>{editingId ? 'Change event' : 'New event'}</Text>
        <Text style={styles.subtitle}>Shown on Home for everyone</Text>
      </View>
    </View>
  );

  if (loadingAccess || (canManage && loading)) {
    return (
      <Page styles={styles} theme={theme}>
        {header}
        <Card style={styles.centerCard}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.body}>{loadingAccess ? 'Checking what you can do here…' : 'Opening the event…'}</Text>
        </Card>
      </Page>
    );
  }

  if (!canManage) {
    return (
      <Page styles={styles} theme={theme}>
        {header}
        <Card style={styles.centerCard}>
          <Ionicons name="lock-closed-outline" size={30} color={theme.colors.accent} />
          <Text style={styles.cardTitle}>For church leaders</Text>
          <Text style={styles.body}>Only leaders and staff can add or change events. Ask an OGN admin if you should be one.</Text>
        </Card>
      </Page>
    );
  }

  if (loadError) {
    return (
      <Page styles={styles} theme={theme}>
        {header}
        <Card style={styles.centerCard}>
          <Ionicons name="cloud-offline-outline" size={30} color={theme.colors.warning} />
          <Text style={styles.body}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load(); }} style={styles.primaryButton}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        </Card>
      </Page>
    );
  }

  if (saved) {
    const openEvent = (send: boolean) =>
      router.replace({ pathname: '/event-detail', params: send ? { id: saved.id, send: '1' } : { id: saved.id } } as any);
    return (
      <Page styles={styles} theme={theme}>
        {header}
        <Card style={styles.centerCard}>
          <View style={styles.successRing}>
            <Ionicons name="checkmark" size={36} color={theme.colors.textOnAccent} />
          </View>
          <Text style={styles.cardTitle}>{editingId ? 'Event updated' : 'Event saved'}</Text>
          <Text style={styles.body}>
            {saved.published && !occurrenceAtOrAfter(saved, new Date())
              ? `"${saved.title}" is saved, but its date has already gone by, so it is not on Home. It is under Finished in Manage events, where attendance can be logged.`
              : saved.published
              ? `"${saved.title}" is on Home for everyone.`
              : `"${saved.title}" is saved as a draft. Only leaders can see it until you switch on "Show it on Home".`}
          </Text>
          {saved.published ? (
            <Pressable accessibilityRole="button" onPress={() => openEvent(true)} style={styles.primaryButton}>
              <Ionicons name="paper-plane-outline" size={18} color={theme.colors.textOnAccent} />
              <Text style={styles.primaryText}>Send it to chat groups</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => openEvent(false)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>See the event</Text>
          </Pressable>
          {!editingId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSaved(null);
                dirty.current = false;
                setForm(blankForm());
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Add another event</Text>
            </Pressable>
          ) : null}
        </Card>
      </Page>
    );
  }

  const weekly = form.recurrence === 'weekly';

  return (
    <KeyboardAvoidingView style={styles.grow} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Page styles={styles} theme={theme} refreshing={pulling} onRefresh={editingId && !dirty.current ? () => void pullToRefresh() : undefined}>
        {header}

        {status === 'cancelled' ? (
          <Card style={styles.warnCard}>
            <Ionicons name="close-circle-outline" size={22} color={theme.colors.danger} />
            <Text style={styles.warnText}>This event is cancelled. It shows on Home marked "Cancelled".</Text>
          </Card>
        ) : null}

        <Text style={styles.label}>Photo or flyer (optional)</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={form.imageUrl ? 'Change the event photo' : 'Add a photo or flyer for this event'}
          disabled={working}
          onPress={() => void pickPhoto()}
          style={styles.photoBox}
        >
          {form.imageUrl ? (
            <Image source={{ uri: form.imageUrl }} style={styles.photo} resizeMode="cover" accessibilityLabel="The event photo you chose" />
          ) : (
            <View style={styles.photoEmpty}>
              <Ionicons name="image-outline" size={32} color={theme.colors.accent} />
              <Text style={styles.photoHint}>Tap to add a photo</Text>
            </View>
          )}
        </Pressable>
        {form.imageUrl && !transfer ? (
          <Pressable accessibilityRole="button" onPress={() => update({ imageUrl: '' })} disabled={working} style={styles.linkButton}>
            <Text style={styles.linkText}>Remove the photo</Text>
          </Pressable>
        ) : null}
        {transfer ? <UploadBar label={transfer.label} fraction={transfer.fraction} styles={styles} theme={theme} /> : null}

        <Field styles={styles} theme={theme} label="Name of the event" value={form.title} onChange={(title) => update({ title })} placeholder="Like Sunday Service or Bible Study" />
        <Field styles={styles} theme={theme} label="What people should know (optional)" value={form.description} onChange={(description) => update({ description })} placeholder="Who it is for, what to bring, who is speaking" multiline />

        <Text style={styles.label}>How often</Text>
        <View style={styles.chips}>
          {([
            { key: 'none', label: 'Just once' },
            { key: 'weekly', label: 'Every week' },
          ] as { key: EventRecurrence; label: string }[]).map((choice) => {
            const on = form.recurrence === choice.key;
            return (
              <Pressable
                key={choice.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                aria-checked={on}
                onPress={() => update({ recurrence: choice.key })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? theme.colors.textOnAccent : theme.colors.accent} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>{weekly ? 'First day' : 'Day'}</Text>
        <Stepper
          styles={styles}
          theme={theme}
          value={fullDayText(form.start)}
          lessLabel="One day earlier"
          moreLabel="One day later"
          onLess={() => moveStart(addLocalDays(form.start, -1))}
          onMore={() => moveStart(addLocalDays(form.start, 1))}
        />
        <View style={styles.smallRow}>
          <SmallStep styles={styles} label="A week earlier" onPress={() => moveStart(addLocalDays(form.start, -7))} />
          <SmallStep styles={styles} label="A week later" onPress={() => moveStart(addLocalDays(form.start, 7))} />
        </View>

        <Text style={styles.label}>Starts at</Text>
        <Stepper
          styles={styles}
          theme={theme}
          value={timeText(form.start)}
          lessLabel="15 minutes earlier"
          moreLabel="15 minutes later"
          onLess={() => moveStart(new Date(form.start.getTime() - 15 * MINUTE))}
          onMore={() => moveStart(new Date(form.start.getTime() + 15 * MINUTE))}
        />
        <View style={styles.smallRow}>
          <SmallStep styles={styles} label="An hour earlier" onPress={() => moveStart(new Date(form.start.getTime() - 60 * MINUTE))} />
          <SmallStep styles={styles} label="An hour later" onPress={() => moveStart(new Date(form.start.getTime() + 60 * MINUTE))} />
        </View>

        <Text style={styles.label}>Ends at</Text>
        <Stepper
          styles={styles}
          theme={theme}
          value={timeText(form.end)}
          lessLabel="End 15 minutes earlier"
          moreLabel="End 15 minutes later"
          onLess={() => moveEnd(new Date(form.end.getTime() - 15 * MINUTE))}
          onMore={() => moveEnd(new Date(form.end.getTime() + 15 * MINUTE))}
        />

        <Card style={styles.summaryCard}>
          <Ionicons name="calendar-outline" size={20} color={theme.colors.accent} />
          <Text style={styles.summaryText}>
            {weekly
              ? `Every ${weekdayName(form.start)}, ${timeText(form.start)} to ${timeText(form.end)}, starting ${fullDayText(form.start)}.`
              : `${fullDayText(form.start)}, ${timeText(form.start)} to ${timeText(form.end)}.`}
          </Text>
        </Card>

        <Field styles={styles} theme={theme} label="Where (optional)" value={form.location} onChange={(location) => update({ location })} placeholder="The church address, a hall, or Online" />
        <Field
          styles={styles}
          theme={theme}
          label="Map link (optional)"
          value={form.locationUrl}
          onChange={(locationUrl) => update({ locationUrl })}
          placeholder="Paste a Google or Apple Maps link"
          url
        />
        <Field
          styles={styles}
          theme={theme}
          label="Watch or sign-up link (optional)"
          value={form.registrationUrl}
          onChange={(registrationUrl) => update({ registrationUrl })}
          placeholder="A YouTube, Facebook or sign-up page"
          url
        />

        <View style={styles.switchRow}>
          <View style={styles.grow}>
            <Text style={styles.switchLabel}>Show it on Home now</Text>
            <Text style={styles.switchHint}>Switch off to save a draft only leaders can see.</Text>
          </View>
          <Switch
            accessibilityLabel="Show it on Home now"
            value={form.published}
            onValueChange={(published) => update({ published })}
            trackColor={{ true: theme.colors.accentSolid, false: theme.colors.borderStrong }}
            thumbColor={theme.colors.surfaceRaised}
          />
        </View>

        {problem ? (
          <Card style={styles.warnCard}>
            <Ionicons name="alert-circle-outline" size={22} color={theme.colors.warning} />
            <Text style={styles.warnText}>{problem}</Text>
          </Card>
        ) : null}

        <Pressable accessibilityRole="button" accessibilityState={{ disabled: working }} disabled={working} onPress={() => void save()} style={[styles.saveButton, working && styles.dimmed]}>
          {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
          <Text style={styles.saveText}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save event'}</Text>
        </Pressable>

        {editingId ? (
          <View style={styles.moreBlock}>
            <Pressable accessibilityRole="button" disabled={working} onPress={toggleCancelled} style={styles.secondaryButton}>
              <Ionicons name={status === 'cancelled' ? 'refresh-outline' : 'close-circle-outline'} size={18} color={theme.colors.accent} />
              <Text style={styles.secondaryText}>{status === 'cancelled' ? 'Bring this event back' : 'Cancel this event'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working} onPress={confirmDelete} style={styles.dangerButton}>
              <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
              <Text style={styles.dangerText}>Delete this event</Text>
            </Pressable>
          </View>
        ) : null}
      </Page>
    </KeyboardAvoidingView>
  );
}

// ---------- Small pieces ----------

type Styles = ReturnType<typeof useStyles>;

/** Safe on every edge, scrolls, and (when there is something to reload) pulls to refresh. */
function Page({
  styles,
  theme,
  refreshing,
  onRefresh,
  children,
}: {
  styles: Styles;
  theme: AppTheme;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
      <ScrollView
        style={styles.grow}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  styles,
  theme,
  label,
  value,
  onChange,
  placeholder,
  multiline,
  url,
}: {
  styles: Styles;
  theme: AppTheme;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  url?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        multiline={multiline}
        autoCapitalize={url ? 'none' : 'sentences'}
        autoCorrect={!url}
        keyboardType={url ? 'url' : 'default'}
        style={[styles.field, multiline && styles.fieldTall]}
      />
    </View>
  );
}

function Stepper({
  styles,
  theme,
  value,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
}: {
  styles: Styles;
  theme: AppTheme;
  value: string;
  lessLabel: string;
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${lessLabel}. Now ${value}`} onPress={onLess} style={styles.stepButton}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.accent} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLiveRegion="polite">{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${moreLabel}. Now ${value}`} onPress={onMore} style={styles.stepButton}>
        <Ionicons name="chevron-forward" size={22} color={theme.colors.accent} />
      </Pressable>
    </View>
  );
}

function SmallStep({ styles, label, onPress }: { styles: Styles; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.smallStep}>
      <Text style={styles.smallStepText}>{label}</Text>
    </Pressable>
  );
}

function UploadBar({ label, fraction, styles, theme }: { label: string; fraction: number; styles: Styles; theme: AppTheme }) {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <View style={styles.progress} accessibilityLabel={`${label}. ${percent} percent sent.`} accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <View style={styles.progressHead}>
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressPercent}>{percent}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(4, percent)}%` }]} />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: t.colors.page },
    // The same gutter every pushed screen uses (components/Screen.tsx).
    scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
    grow: { flex: 1 },
    dimmed: { opacity: 0.6 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    backButton: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
    subtitle: { color: t.colors.textMuted, fontSize: t.type.body, marginTop: 2 },
    centerCard: { alignItems: 'center', gap: 12, paddingVertical: 26 },
    cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, textAlign: 'center' },
    body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22, textAlign: 'center' },
    label: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta, marginTop: 14, marginBottom: 6 },
    fieldWrap: { gap: 0 },
    field: {
      minHeight: 52,
      borderRadius: t.radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: t.colors.surfaceSunken,
      color: t.colors.textPrimary,
      fontSize: t.type.body,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    fieldTall: { minHeight: 104, textAlignVertical: 'top' },
    photoBox: {
      width: '100%',
      aspectRatio: 16 / 9,
      minHeight: 120,
      borderRadius: t.radius.xl,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.accentMuted,
      overflow: 'hidden',
    },
    photo: { width: '100%', height: '100%' },
    photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    photoHint: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
    linkButton: { minHeight: 48, minWidth: 48, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 },
    linkText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.body },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: {
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 52,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
    chipTextOn: { color: t.colors.textOnAccent },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 6,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
    },
    stepButton: {
      minWidth: 52,
      minHeight: 52,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.accentMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepValue: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, textAlign: 'center' },
    smallRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    smallStep: {
      flex: 1,
      minHeight: 48,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    smallStepText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.meta, textAlign: 'center' },
    summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    summaryText: { flex: 1, color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.body, lineHeight: 21 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 18,
      padding: 14,
      minHeight: 56,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
    },
    switchLabel: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    switchHint: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2, lineHeight: 18 },
    warnCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, backgroundColor: t.colors.warningMuted, borderColor: t.colors.warning },
    warnText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.body, lineHeight: 21 },
    saveButton: {
      marginTop: 18,
      minHeight: 56,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
      ...t.elevation.low,
    },
    saveText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
    moreBlock: { marginTop: 22, gap: 10 },
    primaryButton: {
      alignSelf: 'stretch',
      minHeight: 52,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    primaryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
    secondaryButton: {
      alignSelf: 'stretch',
      minHeight: 52,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    secondaryText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    dangerButton: {
      alignSelf: 'stretch',
      minHeight: 52,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.dangerMuted,
      borderWidth: 1,
      borderColor: t.colors.danger,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    dangerText: { color: t.colors.danger, fontWeight: '900', fontSize: t.type.body },
    successRing: {
      width: 76,
      minHeight: 76,
      borderRadius: 38,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progress: {
      gap: 8,
      marginTop: 10,
      padding: 14,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
    },
    progressHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    progressLabel: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    progressPercent: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.cardTitle },
    progressTrack: { minHeight: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.progressTrack, overflow: 'hidden' },
    progressFill: { minHeight: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.progressFill },
  }),
);
