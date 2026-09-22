// Voice notes and voice-note replies in chat (2026-09-22).
//
// The owner asked for "a voice note reply feature". These tests pin the
// numbers (small files, five minutes, one second), the words a member reads,
// and the promises that live in code: the file goes through the private
// chat-attachments path (DO-NOT-BREAK #20), recording hands the app its
// background-playback mode back (DO-NOT-BREAK #17), and a voice note never
// talks over the sermon in the mini player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const voice = load('lib/voiceNotes.ts', { AudioQuality: { MEDIUM: 64 }, IOSOutputFormat: { MPEG4AAC: 'aac ' }, Platform: { OS: 'android' } });

test('small files: mono AAC .m4a at 48 kbps, so five minutes is under 2 MB', () => {
  const r = voice.VOICE_NOTE_RECORDING;
  assert.equal(r.numberOfChannels, 1);
  assert.equal(r.bitRate, 48000);
  assert.equal(r.extension, '.m4a');
  assert.equal(r.android.outputFormat, 'mpeg4');
  assert.equal(r.android.audioEncoder, 'aac');
  assert.equal(r.ios.outputFormat, 'aac ');
  const bytesForFiveMinutes = (r.bitRate / 8) * 300;
  assert.ok(bytesForFiveMinutes < 2 * 1024 * 1024, `${bytesForFiveMinutes} bytes`);
  assert.equal(voice.VOICE_NOTE_MIME, 'audio/mp4', 'a type the private chat-attachments bucket already accepts');
});

test('five minutes at most, and a slip of the thumb is not sent', () => {
  assert.equal(voice.VOICE_NOTE_MAX_MS, 300000);
  assert.equal(voice.recordingHitLimit(299999), false);
  assert.equal(voice.recordingHitLimit(300000), true);
  assert.equal(voice.recordingOutcome(400), 'too-short');
  assert.equal(voice.recordingOutcome(1000), 'send');
});

test('the words: 0:12, Voice note 0:12, "12 seconds" for a screen reader', () => {
  assert.equal(voice.formatVoiceClock(0), '0:00');
  assert.equal(voice.formatVoiceClock(12400), '0:12');
  assert.equal(voice.formatVoiceClock(299999), '4:59');
  assert.equal(voice.formatVoiceClock(3723000), '1:02:03');
  assert.equal(voice.formatVoiceClock(-5), '0:00');
  assert.equal(voice.formatVoiceClock(undefined), '0:00');
  assert.equal(voice.voiceNoteLabel(12400), 'Voice note 0:12');
  assert.equal(voice.voiceNoteLabel(0), 'Voice note');
  assert.equal(voice.spokenDuration(1000), '1 second');
  assert.equal(voice.spokenDuration(12400), '12 seconds');
  assert.equal(voice.spokenDuration(60000), '1 minute');
  assert.equal(voice.spokenDuration(65000), '1 minute 5 seconds');
});

test('speed goes 1x, 1.5x, 2x and round again', () => {
  assert.equal(voice.nextVoiceRate(1), 1.5);
  assert.equal(voice.nextVoiceRate(1.5), 2);
  assert.equal(voice.nextVoiceRate(2), 1);
  assert.equal(voice.nextVoiceRate(0.7), 1);
  assert.equal(voice.formatVoiceRate(1), '1x');
  assert.equal(voice.formatVoiceRate(1.5), '1.5x');
  assert.equal(voice.playbackFraction(3, 12), 0.25);
  assert.equal(voice.playbackFraction(30, 12), 1);
  assert.equal(voice.playbackFraction(3, 0), 0);
});

test('which audio is a voice note (inline player) and which is a picked file (the big player)', () => {
  assert.equal(voice.isVoiceNote({ kind: 'audio', name: 'voice-note-1727000000000.m4a' }), true);
  assert.equal(voice.isVoiceNote({ kind: 'audio', name: 'sermon.mp3', durationMs: 5000 }), true);
  assert.equal(voice.isVoiceNote({ kind: 'audio', name: 'sermon.mp3' }), false);
  assert.equal(voice.isVoiceNote({ kind: 'image', name: 'voice-note-1.m4a' }), false);
  assert.equal(voice.isVoiceNote(null), false);
  assert.match(voice.voiceNoteFileName(1727000000000), /^voice-note-1727000000000\.m4a$/);
});

test('recording only where the file will play everywhere: iPhone and Android, not the browser', () => {
  assert.equal(voice.canRecordVoiceNotes('ios'), true);
  assert.equal(voice.canRecordVoiceNotes('android'), true);
  assert.equal(voice.canRecordVoiceNotes('web'), false);
});

test('DO-NOT-BREAK #20: a voice note goes through the same private upload as a photo', () => {
  const room = read('app/chat-room.tsx');
  assert.match(room, /uploadChatAttachment\(roomId, \{ uri: note\.uri, name, mimeType: VOICE_NOTE_MIME \}, \{ onProgress \}\)/);
  // ...and is sent as a reply when one was picked, with its length
  assert.match(room, /sendChatMessage\(roomId, '', \{ \.\.\.uploaded, durationMs: note\.durationMs \}, undefined, \{ parentMessageId: answering\?\.id \}\)/);
  const service = read('lib/chatService.ts');
  assert.match(service, /const path = `\$\{channelId\}\/\$\{userId\}\/\$\{Date\.now\(\)\}-\$\{safeName\}`;/, 'still <room>/<user>/');
  assert.match(service, /createSignedUrls\(unique, ATTACHMENT_LINK_TTL\)/, 'still read through signed links');
  assert.match(service, /row\.attachment_duration_ms = Math\.min\(600000, Math\.round\(attachment\.durationMs\)\)/);
});

test('DO-NOT-BREAK #17: recording gives the app its background-playback mode back', () => {
  const recorder = read('components/VoiceNoteRecorder.tsx');
  // the recording mode is the player's own mode with only the microphone added
  assert.match(recorder, /setAudioModeAsync\(\{ \.\.\.PLAYBACK_AUDIO_MODE, allowsRecording: true \}\)/);
  assert.match(recorder, /if \(!recording\) \{\s+await restorePlaybackAudioMode\(\);/);
  // every way out of recording restores it: stop, delete, and leaving the room
  assert.ok((recorder.match(/setVoiceRecordingMode\(false\)/g) || []).length >= 4);
  // the microphone is asked for kindly, and "no" has a way to Settings
  assert.match(recorder, /Linking\.openSettings\(\)/);
  assert.match(recorder, /It only listens while you are recording/);
});

test('a voice note and the sermon in the mini player never talk over each other', () => {
  const player = read('components/VoiceNotePlayer.tsx');
  assert.match(player, /if \(nowPlaying\.playing\) nowPlaying\.toggle\(\);/, 'starting a voice note pauses the main player');
  assert.match(player, /if \(nowPlaying\.playing && !mainWasPlaying\.current && status\.playing\) player\.pause\(\);/, 'and the main player starting pauses the voice note');
  // one player for the whole room, so only one voice note plays at a time
  assert.equal((player.match(/useAudioPlayer\(/g) || []).length, 1);
  const room = read('app/chat-room.tsx');
  assert.match(room, /<VoiceNotePlaybackProvider>\s*<ChatRoomView \/>/);
  // recording quiets both first
  assert.match(room, /voicePlayback\?\.pauseAll\(\);\s+if \(nowPlaying\.playing\) nowPlaying\.toggle\(\);/);
});

test('a voice note can be a reply: the quote stays above the recorder', () => {
  const room = read('app/chat-room.tsx');
  const replyBar = room.indexOf('<ReplyComposerBar');
  const recorderBar = room.indexOf('<VoiceNoteRecordingBar');
  assert.ok(replyBar > 0 && recorderBar > replyBar, 'the reply quote is drawn above the recorder, outside it');
  assert.doesNotMatch(room.slice(recorderBar, recorderBar + 400), /setReplyTo\(null\)/, 'starting to record does not drop the reply');
});
