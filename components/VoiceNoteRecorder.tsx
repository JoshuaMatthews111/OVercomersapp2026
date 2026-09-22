// Recording a voice note, in the chat composer.
//
//   Tap the microphone      -> it asks for the microphone the first time,
//                              in plain words, then starts recording.
//   While recording         -> Delete, the running time, Stop, Send.
//   Stop                    -> listen back first, then Delete or Send.
//   Five minutes            -> it stops by itself and keeps what was said.
//   Leaving the app         -> it stops and keeps what was said.
//
// The recorder only exists while this bar is on screen, so an idle chat room
// holds no microphone and polls nothing.
import { Ionicons } from '@expo/vector-icons';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { PLAYBACK_AUDIO_MODE, restorePlaybackAudioMode } from '../lib/nowPlaying';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import {
  VOICE_NOTE_MAX_MS,
  VOICE_NOTE_RECORDING,
  formatVoiceClock,
  recordingHitLimit,
  recordingOutcome,
  spokenDuration,
} from '../lib/voiceNotes';
import { VoiceNoteBubble } from './VoiceNotePlayer';

export type RecordedVoiceNote = { uri: string; durationMs: number };

/**
 * The microphone on or off. expo-audio keeps ONE mode for the whole app, and
 * a call replaces all of it, so recording starts from the player's own
 * playback mode (lib/nowPlaying.tsx) with only the microphone added, and ends
 * by handing that exact mode back — sermons keep playing with the screen off.
 * Never throws: a failure here must not strand the composer.
 */
async function setVoiceRecordingMode(recording: boolean): Promise<boolean> {
  if (!recording) {
    await restorePlaybackAudioMode();
    return true;
  }
  try {
    await setAudioModeAsync({ ...PLAYBACK_AUDIO_MODE, allowsRecording: true });
    return true;
  } catch {
    // prepareToRecordAsync then says so, and the person is told.
    return false;
  }
}

/** Stop the recorder whatever state it is in. False when there was nothing to stop. */
async function stopQuietly(recorder: { stop: () => Promise<void> }): Promise<boolean> {
  try {
    await recorder.stop();
    return true;
  } catch {
    return false;
  }
}

function openPhoneSettings() {
  Linking.openSettings().catch(() => undefined);
}

function explainSettings() {
  Alert.alert(
    'The microphone is turned off',
    'To send a voice note, allow the microphone for Overcomers in your phone’s Settings. You can turn it off again at any time.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: openPhoneSettings },
    ],
  );
}

/**
 * Ask for the microphone, kindly. The first time, the app says why before the
 * phone's own question appears. If the answer was no, it says where to change
 * that, rather than a button that silently does nothing.
 */
export async function askForMicrophone(): Promise<boolean> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) {
      explainSettings();
      return false;
    }
    if (current.status === 'undetermined') {
      const goAhead = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Send a voice note',
          'Overcomers needs your microphone to record a voice note. It only listens while you are recording, and only the people in this chat hear it.',
          [
            { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!goAhead) return false;
    }
    const asked = await requestRecordingPermissionsAsync();
    if (asked.granted) return true;
    if (asked.canAskAgain === false) explainSettings();
    else Alert.alert('No microphone, no voice note', 'That is all right. Tap the microphone again whenever you would like to allow it.');
    return false;
  } catch {
    Alert.alert('The microphone did not start', 'Please try again in a moment.');
    return false;
  }
}

/** Best effort: a voice note that was not sent should not sit on the phone. */
function throwAway(uri?: string | null): boolean {
  if (!uri) return false;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch {
    // It is in the cache folder; the phone clears it in time.
    return false;
  }
}

type Phase = 'starting' | 'recording' | 'stopping' | 'review';

/**
 * Takes the place of the message box while a voice note is being made. The
 * reply quote above the composer stays where it is, so a voice note can be a
 * reply.
 */
export function VoiceNoteRecordingBar({
  dark,
  onCancel,
  onSend,
  onProblem,
}: {
  dark: boolean;
  onCancel: () => void;
  onSend: (note: RecordedVoiceNote) => void;
  onProblem: (message: string) => void;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const recorder = useAudioRecorder(VOICE_NOTE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<Phase>('starting');
  const [draft, setDraft] = useState<RecordedVoiceNote | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const startedAt = useRef(0);
  const longest = useRef(0);
  const phaseRef = useRef<Phase>('starting');
  const finished = useRef(false);
  // The latest of each, so the callbacks below never go stale and never need re-making.
  const draftRef = useRef<RecordedVoiceNote | null>(null);
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;

  const setPhaseBoth = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  // The longest time seen, so a status that resets on stop cannot lose it.
  useEffect(() => {
    const elapsed = recorderState.durationMillis || 0;
    if (elapsed > longest.current) longest.current = elapsed;
  }, [recorderState.durationMillis]);

  // Start once, when the bar appears.
  useEffect(() => {
    let cancelled = false;
    // Deleted or left while the microphone was still getting ready: the bar
    // is gone, so nothing else will hand the app its playback mode back.
    // Without this, sermons would lose screen-off play (media lane rule).
    const giveBack = async () => {
      await stopQuietly(recorder);
      await setVoiceRecordingMode(false);
    };
    (async () => {
      try {
        await setVoiceRecordingMode(true);
        if (cancelled) { await giveBack(); return; }
        await recorder.prepareToRecordAsync();
        if (cancelled) { await giveBack(); return; }
        recorder.record();
        startedAt.current = Date.now();
        setPhaseBoth('recording');
      } catch {
        await setVoiceRecordingMode(false);
        if (cancelled) return;
        finished.current = true;
        onProblemRef.current('The microphone could not start. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
      // Leaving the room mid-recording: stop, and give the app its normal
      // sound back so sermons keep playing with the screen off.
      if (!finished.current) {
        finished.current = true;
        void stopQuietly(recorder).then(() => setVoiceRecordingMode(false)).catch(() => false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Stop recording and hand back what was said. Null when there was nothing worth keeping. */
  const stopRecording = useCallback(async (): Promise<RecordedVoiceNote | null> => {
    if (phaseRef.current !== 'recording') return draftRef.current;
    setPhaseBoth('stopping');
    let measured = longest.current;
    try {
      measured = Math.max(measured, recorder.getStatus().durationMillis || 0);
    } catch {
      measured = longest.current;
    }
    // Only when the recorder never reported a time at all, fall back to the clock.
    if (!measured && startedAt.current) measured = Date.now() - startedAt.current;
    const durationMs = Math.min(VOICE_NOTE_MAX_MS, Math.round(measured));
    // Even when stop complains, the file is usually complete; it is checked below.
    await stopQuietly(recorder);
    await setVoiceRecordingMode(false);
    const uri = recorder.uri;
    if (!uri) {
      finished.current = true;
      onProblemRef.current('That voice note could not be saved. Please try again.');
      return null;
    }
    if (recordingOutcome(durationMs) === 'too-short') {
      throwAway(uri);
      finished.current = true;
      onProblemRef.current('That was too short to send. Tap the microphone, speak, then tap Send.');
      return null;
    }
    const note = { uri, durationMs };
    draftRef.current = note;
    setDraft(note);
    setPhaseBoth('review');
    return note;
  }, [recorder]);

  // Five minutes: stop by itself, keep everything, let the person decide.
  useEffect(() => {
    if (phase !== 'recording' || !recordingHitLimit(recorderState.durationMillis || 0)) return;
    setLimitReached(true);
    void stopRecording();
  }, [phase, recorderState.durationMillis, stopRecording]);

  // Leaving the app stops the microphone; what was said so far is kept.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && phaseRef.current === 'recording') void stopRecording();
    });
    return () => sub.remove();
  }, [stopRecording]);

  async function send() {
    if (phaseRef.current === 'starting' || phaseRef.current === 'stopping') return;
    const note = phaseRef.current === 'recording' ? await stopRecording() : draftRef.current;
    if (!note) return;
    finished.current = true;
    onSend(note);
  }

  async function discard() {
    if (phaseRef.current === 'recording') {
      setPhaseBoth('stopping');
      await stopQuietly(recorder);
      await setVoiceRecordingMode(false);
      throwAway(recorder.uri);
    } else {
      throwAway(draftRef.current?.uri);
    }
    finished.current = true;
    onCancel();
  }

  const recording = phase === 'recording';
  const busy = phase === 'starting' || phase === 'stopping';
  const shownMs = recording ? recorderState.durationMillis || 0 : draft?.durationMs || longest.current;

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete this voice note"
        onPress={() => { void discard(); }}
        disabled={phase === 'stopping'}
        style={({ pressed }) => [styles.roundButton, styles.deleteButton, pressed && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={22} color={theme.colors.danger} />
      </Pressable>

      {phase === 'review' && draft ? (
        <View style={styles.middle}>
          <VoiceNoteBubble id="voice-note-draft" url={draft.uri} durationMs={draft.durationMs} own dark={dark} />
          {limitReached ? <Text style={styles.hint}>Five minutes is the longest a voice note can be.</Text> : null}
        </View>
      ) : (
        <View
          style={styles.middle}
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={busy ? 'Getting the microphone ready' : `Recording, ${spokenDuration(shownMs)}. Up to five minutes.`}
        >
          <View style={styles.statusRow}>
            {busy ? <ActivityIndicator size="small" color={theme.colors.danger} /> : <View style={styles.recDot} />}
            <Text style={styles.clock}>{formatVoiceClock(shownMs)}</Text>
            <Text style={styles.statusWord}>{busy ? 'Getting ready…' : 'Recording'}</Text>
          </View>
          <Text style={styles.hint}>Up to {formatVoiceClock(VOICE_NOTE_MAX_MS)}. Tap Stop to listen first.</Text>
        </View>
      )}

      {recording ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording and listen back"
          onPress={() => { void stopRecording(); }}
          style={({ pressed }) => [styles.roundButton, styles.stopButton, pressed && styles.pressed]}
        >
          <Ionicons name="stop" size={20} color={theme.colors.textPrimary} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send this voice note"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => { void send(); }}
        style={({ pressed }) => [styles.roundButton, styles.sendButton, busy && styles.idle, pressed && styles.pressed]}
      >
        <Ionicons name="send" size={18} color={theme.colors.textOnBrand} />
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 64 },
  roundButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { backgroundColor: t.colors.dangerMuted },
  stopButton: { backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.borderStrong },
  sendButton: { backgroundColor: t.colors.brandSolid },
  idle: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  middle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: t.colors.danger },
  clock: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, fontVariant: ['tabular-nums'] },
  statusWord: { flexShrink: 1, color: t.colors.danger, fontWeight: '800', fontSize: t.type.meta },
  hint: { color: t.colors.textSecondary, fontSize: t.type.overline, lineHeight: 16, marginTop: 2 },
}));
