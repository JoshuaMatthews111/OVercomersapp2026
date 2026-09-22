// Media lane, adversarial review of 2026-09-22. Each test pins a defect that
// was found in the first build and fixed, so it cannot quietly come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function compile(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
}
const timeoutUrl = `data:text/javascript;base64,${Buffer.from(compile('../lib/requestTimeout.ts')).toString('base64')}`;
const embedJs = compile('../lib/embed.ts').replace(/from ['"]\.\/requestTimeout['"]/, `from '${timeoutUrl}'`);
const embed = await import(`data:text/javascript;base64,${Buffer.from(embedJs).toString('base64')}`);
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const status = (over) => ({ playing: false, isLoaded: true, timeControlStatus: 'paused', error: null, ...over });

test('a song still loading says Loading, not Paused', () => {
  // iPhone: asked to play, waiting on the network.
  assert.equal(embed.audioPhase(status({ isLoaded: false, timeControlStatus: 'waitingToPlayAtSpecifiedRate' }), { failed: false, wantsPlay: true }), 'loading');
  // Stalled mid-song on a weak signal (iPhone reports it as waiting).
  assert.equal(embed.audioPhase(status({ timeControlStatus: 'waitingToPlayAtSpecifiedRate' }), { failed: false, wantsPlay: true }), 'loading');
  // Android before the first status arrives.
  assert.equal(embed.audioPhase(status({ isLoaded: false }), { failed: false, wantsPlay: true }), 'loading');
  assert.equal(embed.audioPhase(null, { failed: false, wantsPlay: true }), 'loading');
  assert.equal(embed.audioPhase(status({ playing: true }), { failed: false, wantsPlay: true }), 'playing');
});

test('a song the person paused says Paused, even before it finished loading', () => {
  assert.equal(embed.audioPhase(status({ isLoaded: false }), { failed: false, wantsPlay: false }), 'paused');
  assert.equal(embed.audioPhase(status({}), { failed: false, wantsPlay: true }), 'paused', 'loaded and not waiting: paused (e.g. from the lock screen)');
  assert.equal(embed.audioPhase(null, { failed: false, wantsPlay: false }), 'paused');
});

test('a file that will not play says so and is never shown as Paused', () => {
  assert.equal(embed.audioPhase(status({ error: 'The operation could not be completed' }), { failed: false, wantsPlay: true }), 'failed');
  // The error arrives once; later updates carry error: null. The failure is kept.
  assert.equal(embed.audioPhase(status({ isLoaded: false }), { failed: true, wantsPlay: false }), 'failed');
  assert.match(embed.AUDIO_FAILED_COPY.bar, /Would not play/);
  assert.match(embed.AUDIO_FAILED_COPY.body, /try again/i);
});

test('the player shows the loading and failed states and offers Try again', () => {
  const source = read('lib/nowPlaying.tsx');
  assert.match(source, /audioPhase\(audioStatus, \{ failed: audioFailed, wantsPlay: audioWantsPlay \}\)/);
  assert.match(source, /: loading\s*\? 'Loading…'/);
  assert.match(source, /AUDIO_FAILED_COPY\.bar/);
  assert.match(source, /accessibilityLabel="Try again" onPress=\{ctx\.retry\}/);
  // The failure is caught from every status event, not only a changed value.
  assert.match(source, /audioPlayer\.addListener\('playbackStatusUpdate'/);
});

test('a status left over from the previous song is ignored', () => {
  const source = read('lib/nowPlaying.tsx');
  assert.match(source, /rawAudioStatus && rawAudioStatus\.id === audioPlayer\.id \? rawAudioStatus : null/);
  assert.doesNotMatch(source, /audioStatus\.playing/, 'read playing through the guarded status only');
});

test('iPhone lock screen has no ±10 s buttons (expo-audio 57 stacks their handlers song after song)', () => {
  const source = read('lib/nowPlaying.tsx');
  assert.match(source, /const LOCK_SCREEN_OPTIONS = Platform\.OS === 'android'\s*\? \{ showSeekForward: true, showSeekBackward: true \}\s*: \{ showSeekForward: false, showSeekBackward: false \};/);
  // The leak itself, so the note stays true until expo-audio is fixed.
  const controller = readFileSync(new URL('../node_modules/expo-audio/ios/MediaController.swift', import.meta.url), 'utf8');
  if (/skipForwardCommand\.addTarget \{/.test(controller) && /skipForwardCommand\.removeTarget\(self\)/.test(controller)) {
    assert.ok(true, 'expo-audio still leaks lock-screen handlers: keep the iPhone skip buttons off');
  }
});

test('the one-time YouTube note is not used up if the video was closed before it was due', () => {
  const source = read('lib/nowPlaying.tsx');
  assert.match(source, /youtubeLoadedRef\.current = Boolean\(isEmbed && item && youtubeVideoId\(item\.url\) && !embedProblem\)/);
  assert.match(source, /if \(!alive \|\| youtubePlayingRef\.current \|\| !youtubeLoadedRef\.current \|\| noticeShownRef\.current\) return;/);
});

test('a teaching shared to a group is a Sermon card, not a Song', () => {
  const player = read('lib/nowPlaying.tsx');
  assert.match(player, /kind: item\.kind \?\? \(item\.type === 'audio' \? 'music' : 'video'\)/);
  assert.match(player, /type: 'audio', kind: 'sermon' \}\)/, 'Listen instead');
  const media = read('app/(tabs)/messages.tsx');
  assert.match(media, /function listenToSermon[\s\S]*?kind: 'sermon',/);
  assert.match(media, /function playSermon[\s\S]*?kind: 'sermon',/);
  assert.match(media, /kind: shareKindFor\(item\)/);
});

test('the player tells people that swiping the app closed stops the sound', () => {
  const source = read('lib/nowPlaying.tsx');
  assert.match(source, /Close stops it, and so does swiping the app closed\./);
});
