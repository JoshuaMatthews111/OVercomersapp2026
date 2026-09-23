import { Ionicons } from '@expo/vector-icons';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { friendlyError } from '../../lib/errorMessages';
import { supabase } from '../../lib/supabase';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * Delete my account — its own page now.
 *
 * MOVED, NOT REWRITTEN. Every word on this screen, the typed confirmation, the
 * three ticked stages, the counting seconds, the second Alert, the call to the
 * ministry's `delete-account` edge function and every one of its half-done
 * cases are the ones that already shipped inside the More tab's panel. Apple
 * 5.1.1(v) and Google Play both require deletion to start AND finish inside the
 * app, and it does that today — so the behaviour was carried over untouched and
 * only its address changed.
 */

/**
 * Deleting an account is the one thing in this app that cannot be undone, so
 * the member has to write this word out before the button will do anything.
 * A tap alone — even a destructive-red one — is too easy to do by mistake.
 */
const DELETE_PHRASE = 'DELETE';

/**
 * The three stages of a deletion, in the order they happen. The page shows
 * all three and ticks them off, so nobody is ever watching a still screen
 * wondering whether the phone is doing anything.
 */
const deleteStages = [
  { key: 'checking', label: 'Checking your sign-in' },
  { key: 'removing', label: 'Removing your account and everything saved with it' },
  { key: 'signout', label: 'Signing this phone out' },
] as const;

type DeleteStage = (typeof deleteStages)[number]['key'];

export default function DeleteAccountScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteStage, setDeleteStage] = useState<DeleteStage>('checking');
  const [deleteSeconds, setDeleteSeconds] = useState(0);
  const [deleteError, setDeleteError] = useState('');
  const [deleteUnfinished, setDeleteUnfinished] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  /**
   * True only once this phone has actually asked for the deletion on this
   * visit. Nothing may be called "removed" before this is true.
   *
   * It matters because a missing sign-in has TWO causes: the account really is
   * gone, or the sign-in simply ran out (it was ended on another phone, or the
   * refresh token expired). Both look identical from here. Before an attempt,
   * the honest reading of a missing sign-in is "you are signed out", and the
   * page says exactly that instead of telling a member their account has been
   * deleted when nobody deleted anything.
   */
  const [attempted, setAttempted] = useState(false);
  const [signedOutNote, setSignedOutNote] = useState('');

  const deleteArmed = deleteConfirmText.trim().toUpperCase() === DELETE_PHRASE;

  /**
   * Leaving this page clears the typed word, so coming back always starts from
   * a stop rather than one tap away from a deletion. That is exactly what the
   * old panel did when it was closed, kept here unchanged.
   */
  useFocusEffect(useCallback(() => () => {
    setDeleteConfirmText('');
    setDeleteError('');
    setDeleteUnfinished(false);
    setSignedOutNote('');
    setAttempted(false);
  }, []));

  // An honest clock. The ministry's server does the removal in one go and
  // cannot report a percentage back, so rather than draw an invented bar this
  // counts the real seconds that have passed and the stage list says which
  // part is running. Nothing on this screen ever waits in silence.
  useEffect(() => {
    if (!deleting) return;
    const startedAt = Date.now();
    setDeleteSeconds(0);
    const timer = setInterval(() => {
      setDeleteSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [deleting]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  /**
   * Pull down to ask, again, whether this sign-in is still here.
   *
   * It matters on this page more than anywhere else: an attempt can finish on
   * the ministry's server and lose its answer on the way back, and it can also
   * remove everything and leave the sign-in standing. Rather than leave a
   * half-told story on screen, a pull re-asks and says what is actually true.
   */
  async function recheckSignIn() {
    if (deleting || rechecking) return;
    setRechecking(true);
    try {
      const settled = await accountStillExists();
      if (settled === 'gone') {
        // Only an attempt made here is proof of a deletion. Without one, a
        // missing sign-in means the sign-in ran out \u2014 say that, and say it
        // without touching anything.
        if (attempted) {
          await finishDeletedAccount();
          return;
        }
        setSignedOutNote('This phone is not signed in any more. Nothing has been deleted \u2014 sign in again on the More tab, and come back here if you still want to close your account.');
        setDeleteError('');
        setDeleteUnfinished(false);
        return;
      }
      if (settled === 'unknown') {
        setDeleteError('We still could not reach the ministry\u2019s server, so we cannot tell you yet. Nothing on this phone has changed.');
        return;
      }
      setSignedOutNote('');
      setDeleteUnfinished(false);
      setDeleteError('');
    } finally {
      setRechecking(false);
    }
  }

  /**
   * Account deletion, in the app, start to finish.
   *
   * Three things have to happen before anything is removed: open this page,
   * write DELETE into the box, then answer one last question. That is on
   * purpose — there is no way back from this, so there must be no way into it
   * by accident either.
   */
  function confirmAccountDeletion() {
    if (deleting) return;
    if (deleteConfirmText.trim().toUpperCase() !== DELETE_PHRASE) {
      Alert.alert('Almost there', 'Write DELETE in the box first, so we know this is really what you want.');
      return;
    }
    const question = 'Delete your account?';
    const detail = 'Your profile, your photo, your prayer requests and the files you sent will be removed for good. Messages you have written in a shared prayer room stay in the conversation, but they will no longer carry your name. This cannot be undone.';
    // Alert.alert with buttons does NOTHING in a web browser (react-native-web),
    // so on web this last question — and with it the whole deletion — never
    // arrived: the button looked dead. The browser's own confirm box asks
    // there instead. Same words, same two answers, and the phone build is
    // untouched. It is the pattern app/follow-ups.tsx already uses.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(`${question}\n\n${detail}`)) {
        void deleteAccount();
      }
      return;
    }
    Alert.alert(
      question,
      detail,
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete it', style: 'destructive', onPress: () => { void deleteAccount(); } },
      ]
    );
  }

  /**
   * Calls the ministry's `delete-account` server function.
   *
   * Apple 5.1.1(v) and Google Play both require deletion to start AND finish
   * inside the app, so there is no email hand-off here any more.
   *
   * Two states matter more than the happy path:
   *
   *  - The call can be cut off before an answer comes back (a weak signal, or
   *    the app's own fifteen-second leash on ordinary requests). Losing the
   *    answer is NOT the same as nothing happening, so instead of guessing we
   *    ask who this phone is signed in as. If that sign-in no longer exists,
   *    the removal did finish and we say so.
   *  - The removal can finish and the sign-in survive it. That is the one
   *    genuinely half-done state, and the member is told exactly that rather
   *    than being sent away believing they are gone.
   */
  async function deleteAccount() {
    setDeleting(true);
    setAttempted(true);
    setDeleteStage('checking');
    setDeleteError('');
    setDeleteUnfinished(false);
    setSignedOutNote('');
    try {
      const { data: current, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!current.session) {
        setDeleteError('This phone is not signed in any more, so there was nothing to remove. Sign in again if you still want to delete your account.');
        return;
      }

      setDeleteStage('removing');
      // The function name is written out in full here on purpose, so a reader —
      // and the release gate — can see that deletion really is performed in app.
      const { data, error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
        body: { confirm: true },
      });

      if (error) {
        const spoken = await serverSentence(error);
        // The server tells us when it removed the content but could not remove
        // the sign-in. Never send somebody away believing they are gone.
        if (spoken.dataRemoved) {
          setDeleteUnfinished(true);
          setDeleteError(spoken.message || 'Everything you had saved has been removed, but your sign-in is still here. Please tap Delete my account once more.');
          return;
        }
        if (spoken.message) {
          setDeleteError(spoken.message);
          return;
        }
        // No answer came back at all. Find out what is actually true before
        // saying anything to the member.
        const settled = await accountStillExists();
        if (settled === 'gone') {
          await finishDeletedAccount();
          return;
        }
        if (settled === 'unknown') {
          setDeleteError('We lost the connection before we heard back, so we cannot tell you yet whether it finished. Nothing else on this phone has changed. Check your signal and open this again.');
          return;
        }
        setDeleteError(friendlyError(error, 'We could not remove your account just now, so it is still here exactly as it was. Please try again in a moment.'));
        return;
      }

      const warnings = Array.isArray((data as { warnings?: unknown })?.warnings)
        ? ((data as { warnings: string[] }).warnings)
        : [];
      await finishDeletedAccount(warnings[0]);
    } catch (err) {
      setDeleteError(friendlyError(err, 'We could not remove your account just now, so it is still here exactly as it was. Please try again in a moment.'));
    } finally {
      setDeleting(false);
    }
  }

  /** Clears this phone and shows the welcome screen, once the account really is gone. */
  async function finishDeletedAccount(extraNote?: string) {
    setDeleteStage('signout');
    // A local sign-out only clears what is stored on this phone. The sign-in it
    // would otherwise end no longer exists, and the auth library treats that as
    // a clean sign-out rather than an error.
    await supabase.auth.signOut({ scope: 'local' });
    setDeleteConfirmText('');
    router.replace('/welcome');
    Alert.alert(
      'Your account is gone',
      extraNote
        ? `We have removed your account and the things you saved in the app. ${extraNote} You are always welcome back.`
        : 'We have removed your account and the things you saved in the app. You are always welcome back.'
    );
  }

  return (
    <Screen scroll={false}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // The More tab's ScrollView carried this when the deletion panel lived
        // there, and the box you write DELETE into is near the bottom of a long
        // page. Without it, iOS leaves that box — and the button under it —
        // behind the keyboard, and Apple 5.1.1(v) deletion cannot be finished.
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={rechecking}
            onRefresh={recheckSignIn}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to More"
          onPress={goBack}
          style={styles.backButton}
          hitSlop={8}
          android_ripple={{ ...ripple, borderless: true, radius: 26 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Delete my account</Text>
          <Text style={styles.subtitle}>This happens here in the app, and it cannot be undone</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.body}>This happens right here in the app, and it cannot be undone.</Text>

        {signedOutNote ? (
          <View style={styles.deleteWarnBox}>
            <Ionicons name="log-out-outline" size={20} color={theme.colors.danger} />
            <Text style={styles.deleteErrorText}>{signedOutNote}</Text>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>What is removed for good</Text>
        <View style={styles.bulletList}>
          <BulletLine styles={styles} theme={theme} text="Your profile, your name and your photo" />
          <BulletLine styles={styles} theme={theme} text="Your private prayer requests, and your name on any prayer you shared openly" />
          <BulletLine styles={styles} theme={theme} text="The photos, videos and files you sent in chat" />
          <BulletLine styles={styles} theme={theme} text="Your own stories, your saved items and your downloads" />
          <BulletLine styles={styles} theme={theme} text="Your sign-in, so this email can no longer open the app" />
        </View>

        <Text style={styles.fieldLabel}>What stays</Text>
        <View style={styles.bulletList}>
          <BulletLine styles={styles} theme={theme} text="Messages you wrote in a shared prayer room stay in the conversation, so it still reads — but they no longer carry your name" />
          <BulletLine styles={styles} theme={theme} text="A prayer other people are praying over stays on the wall with nothing left on it that names you" />
          <BulletLine styles={styles} theme={theme} text="Anything you posted for the ministry itself, such as a sermon or a notice, stays in the library" />
          <BulletLine styles={styles} theme={theme} text="Your giving stays in the ministry's own records, as the law requires, without your name on it" />
        </View>

        {deleting ? (
          <DeleteProgress styles={styles} theme={theme} stage={deleteStage} seconds={deleteSeconds} />
        ) : (
          <>
            <Text style={styles.fieldLabel}>Write DELETE to confirm</Text>
            <TextInput
              accessibilityLabel="Write the word DELETE to confirm"
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder={DELETE_PHRASE}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              style={styles.input}
            />
          </>
        )}

        {deleteError ? (
          <View style={deleteUnfinished ? styles.deleteWarnBox : styles.deleteErrorBox}>
            <Ionicons
              name={deleteUnfinished ? 'alert-circle-outline' : 'information-circle-outline'}
              size={20}
              color={theme.colors.danger}
            />
            <Text style={styles.deleteErrorText}>{deleteError}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          accessibilityState={{ disabled: deleting || !deleteArmed, busy: deleting }}
          disabled={deleting || !deleteArmed}
          onPress={confirmAccountDeletion}
          style={[styles.dangerButton, (deleting || !deleteArmed) && styles.dangerButtonIdle]}
        >
          {deleting
            ? <ActivityIndicator size="small" color={theme.colors.danger} />
            : <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />}
          <Text style={styles.dangerButtonText}>
            {deleting ? 'Removing your account…' : deleteUnfinished ? 'Finish deleting my account' : 'Delete my account'}
          </Text>
        </Pressable>

        {!deleting && !deleteArmed ? (
          <Text style={styles.deleteHint}>Write DELETE above and this button comes to life.</Text>
        ) : null}
      </Card>
      </ScrollView>
    </Screen>
  );
}

/**
 * Asks who this phone is signed in as.
 *
 * 'gone' means the sign-in no longer exists, which is proof the removal
 * finished. 'here' means it does. 'unknown' means we could not reach anyone
 * and must say so rather than guess.
 */
async function accountStillExists(): Promise<'gone' | 'here' | 'unknown'> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user) return 'here';
    const status = (error as { status?: number } | null)?.status;
    if (status === 401 || status === 403 || status === 404) return 'gone';
    if (!error) return 'gone';
    return 'unknown';
  } catch {
    // Nothing is hidden here: the caller turns 'unknown' into a sentence
    // that tells the member we cannot say yet, which is the honest answer.
    return 'unknown';
  }
}

/**
 * The sentence the ministry's server wrote, pulled out of a failed call.
 *
 * When a function answers with anything other than success, supabase hands
 * back a `FunctionsHttpError` whose `context` is the untouched reply. The
 * delete-account function always replies with `{ error: '<a plain sentence>' }`
 * and, when it removed the content but could not remove the sign-in, with
 * `dataRemoved: true` beside it. Reading that is the difference between
 * telling somebody the truth and showing them a generic shrug.
 */
async function serverSentence(error: unknown): Promise<{ message: string; dataRemoved: boolean }> {
  const nothing = { message: '', dataRemoved: false };
  if (!(error instanceof FunctionsHttpError)) return nothing;
  try {
    const body = await error.context.json() as { error?: unknown; dataRemoved?: unknown };
    return {
      message: typeof body?.error === 'string' ? body.error : '',
      dataRemoved: body?.dataRemoved === true,
    };
  } catch {
    // The reply was not readable. Returning nothing here is not a swallowed
    // failure: the caller goes on to check whether the account still exists
    // and tells the member what it found either way.
    return nothing;
  }
}

type Styles = ReturnType<typeof useStyles>;

function BulletLine({ styles, theme, text }: { styles: Styles; theme: AppTheme; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="remove-outline" size={16} color={theme.colors.textMuted} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

/**
 * What is happening while an account is being removed.
 *
 * Every number on here is real. The bar measures stages this phone has
 * actually finished, the spinner sits on the stage that is running right now,
 * and the seconds are counted from when the member tapped. Nothing here is a
 * made-up percentage creeping towards a finish it cannot see.
 */
function DeleteProgress({
  styles,
  theme,
  stage,
  seconds,
}: {
  styles: Styles;
  theme: AppTheme;
  stage: DeleteStage;
  seconds: number;
}) {
  const current = Math.max(0, deleteStages.findIndex((entry) => entry.key === stage));
  const remaining = Math.max(0, deleteStages.length - current);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${deleteStages[current].label}. ${seconds} seconds so far.`}
      style={styles.deleteProgressBox}
    >
      {/* Two flex weights rather than a percentage, so the bar measures
          finished stages and never has to be told a made-up number. */}
      <View style={styles.deleteTrack}>
        <View style={[styles.deleteTrackFill, { flex: current }]} />
        <View style={{ flex: remaining }} />
      </View>

      {deleteStages.map((entry, index) => (
        <View key={entry.key} style={styles.deleteStageRow}>
          {/* One fixed slot for all three glyphs, so the labels line up
              whichever stage is running. */}
          <View style={styles.deleteStageGlyph}>
            {index < current ? (
              <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
            ) : index === current ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Ionicons name="ellipse-outline" size={18} color={theme.colors.textMuted} />
            )}
          </View>
          <Text style={[styles.deleteStageText, index === current && styles.deleteStageTextNow]}>
            {entry.label}
          </Text>
        </View>
      ))}

      <Text style={styles.deleteElapsed}>
        {seconds < 1
          ? 'Starting…'
          : `${seconds} ${seconds === 1 ? 'second' : 'seconds'} so far. Please keep the app open.`}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  scrollView: { flex: 1 },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerText: { flex: 1 },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.meta + 1, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  fieldLabel: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta + 1 },
  bulletList: { gap: 8 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 20 },
  input: {
    minHeight: 52,
    borderRadius: t.radius.lg,
    paddingHorizontal: 14,
    color: t.colors.textPrimary,
    fontSize: t.type.body,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  dangerButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.dangerMuted,
    borderWidth: 1,
    borderColor: t.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dangerButtonIdle: { opacity: 0.55 },
  dangerButtonText: { flexShrink: 1, textAlign: 'center', color: t.colors.danger, fontWeight: '900', fontSize: t.type.body + 1 },
  deleteHint: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 18, textAlign: 'center' },
  deleteErrorBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.dangerMuted,
  },
  deleteWarnBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.dangerMuted,
    borderWidth: 1,
    borderColor: t.colors.danger,
  },
  deleteErrorText: { flex: 1, color: t.colors.danger, fontSize: t.type.meta + 1, lineHeight: 20 },
  deleteProgressBox: { gap: 10 },
  deleteTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: t.colors.progressTrack,
  },
  deleteTrackFill: { backgroundColor: t.colors.progressFill },
  deleteStageRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  deleteStageGlyph: { width: 22, alignItems: 'center' },
  deleteStageText: { flex: 1, color: t.colors.textMuted, fontSize: t.type.meta + 1, lineHeight: 20 },
  deleteStageTextNow: { color: t.colors.textPrimary, fontWeight: '900' },
  deleteElapsed: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 18 },
}));
