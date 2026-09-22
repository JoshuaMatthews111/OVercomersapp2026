// Media, owner's list of 2026-09-22:
//   - the two missing songs (The YHWH Power Chant, Resilience) in Music,
//   - songs and video FILES keep playing with the screen off, with lock-screen
//     controls, checked against the installed expo-audio 57 / expo-video 57,
//   - YouTube is never spoofed into the background: a teaching with its own
//     audio copy offers "Listen" beside "Watch", and the first time a YouTube
//     video stops because the screen went off the bar says so, once.
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

const YT = 'https://youtu.be/G5h7XID3Re8';
const MP3 = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/sermons/sunday.mp3';

test('a teaching with its own audio copy offers Listen beside Watch', () => {
  assert.deepEqual(embed.teachingPlayback({ videoUrl: YT, audioUrl: MP3 }), { watch: YT, listen: MP3, both: true });
  assert.deepEqual(embed.teachingPlayback({ videoUrl: YT }), { watch: YT, listen: null, both: false }, 'no audio copy: Watch only');
  assert.deepEqual(embed.teachingPlayback({ audioUrl: MP3 }), { watch: null, listen: MP3, both: false }, 'audio only: it just plays');
  assert.deepEqual(embed.teachingPlayback({ videoUrl: YT, audioUrl: '   ' }), { watch: YT, listen: null, both: false });
  // A YouTube link typed into the audio box would stop with the screen just
  // the same, so it is never offered as "Listen".
  assert.equal(embed.teachingPlayback({ videoUrl: YT, audioUrl: 'https://www.youtube.com/watch?v=G5h7XID3Re8' }).listen, null);
  assert.equal(embed.teachingPlayback({ videoUrl: YT, audioUrl: 'https://example.org/podcast/episode.m4a?dl=1' }).both, true);
});

test('a finished song starts again from the top when Play is pressed', () => {
  assert.equal(embed.isAtEnd(269.9, 270), true);
  assert.equal(embed.isAtEnd(270, 270), true);
  assert.equal(embed.isAtEnd(120, 270), false);
  assert.equal(embed.isAtEnd(0, 0), false, 'not loaded yet is not the end');
  assert.equal(embed.isAtEnd(Number.NaN, 270), false);
});

function run(steps, { alreadyShown = false } = {}) {
  let state = embed.SCREEN_OFF_NOTICE_START;
  const shown = [];
  for (const [from, to, playing] of steps) {
    const next = embed.screenOffNoticeStep(state, from, to, playing, alreadyShown);
    state = next.state;
    shown.push(next.show);
  }
  return shown;
}

test('the YouTube screen-off note is said only when it is true, and only once', () => {
  // iPhone: lock the screen while a YouTube video plays, come back.
  assert.deepEqual(run([['active', 'inactive', true], ['inactive', 'background', true], ['background', 'active', false]]), [false, false, true]);
  // Android goes straight to the background.
  assert.deepEqual(run([['active', 'background', true], ['background', 'active', false]]), [false, true]);
  // Pulling down Control Centre or a notification is not the screen going off.
  assert.deepEqual(run([['active', 'inactive', true], ['inactive', 'active', true]]), [false, false]);
  // The video was already paused when they left: nothing to explain.
  assert.deepEqual(run([['active', 'background', false], ['background', 'active', false]]), [false, false]);
  // Already told once on this phone: never again.
  assert.deepEqual(run([['active', 'background', true], ['background', 'active', false]], { alreadyShown: true }), [false, false]);
  // After coming back the rule starts fresh.
  const fresh = embed.screenOffNoticeStep({ leftWhilePlaying: true, pending: true }, 'background', 'active', false, false);
  assert.deepEqual(fresh.state, embed.SCREEN_OFF_NOTICE_START);
  assert.equal(embed.YOUTUBE_SCREEN_OFF_NOTICE, 'Videos from YouTube pause when your screen is off');
});

test('songs and audio sermons keep playing with the screen off, with lock-screen controls', () => {
  const source = read('lib/nowPlaying.tsx');
  // The background flag is module-wide in expo-audio 57 and a later
  // setAudioModeAsync (a voice-note recorder) can turn it off.
  assert.match(source, /export const PLAYBACK_AUDIO_MODE[\s\S]*?shouldPlayInBackground: true[\s\S]*?interruptionMode: 'doNotMix'/);
  assert.match(source, /export function restorePlaybackAudioMode\(\): Promise<void>/);
  // ...so it is put back before every new song, and only then does the song
  // take the lock screen and play.
  assert.match(source, /restorePlaybackAudioMode\(\)\.finally\(\(\) => \{[\s\S]*?player\.setActiveForLockScreen\(true, \{[\s\S]*?\}, LOCK_SCREEN_OPTIONS\);\s*player\.play\(\);/);
  assert.match(source, /keepAudioSessionActive: true/);
  assert.match(source, /preferredForwardBufferDuration: AUDIO_BUFFER_AHEAD_SECONDS/);
  assert.match(source, /audioPlayer\.clearLockScreenControls\(\)/, 'Close takes it off the lock screen');
});

test('video files keep playing with the screen off; the empty player is left alone', () => {
  const source = read('lib/nowPlaying.tsx');
  // staysActiveInBackground is set in the setup callback, i.e. before play().
  assert.match(source, /useVideoPlayer\(videoSource, \(player\) => \{[\s\S]*?if \(!videoSource\) return;\s*player\.staysActiveInBackground = true;\s*player\.showNowPlayingNotification = true;/);
  // The VideoView must stay mounted while minimized (expo-video only keeps a
  // player that is attached to a view going in the background).
  assert.match(source, /\{item \? \(\s*<PlayerLayer/);
  assert.match(source, /\{isVideo \? \(\s*<VideoView player=\{videoPlayer\}/);
  assert.doesNotMatch(source, /expanded && isVideo|isVideo && expanded/, 'the video view is never tied to the sheet being open');
});

test('no YouTube background hack anywhere in the player', () => {
  for (const file of ['lib/nowPlaying.tsx', 'lib/embed.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /defineProperty\([^)]*(visibilityState|hidden)/, `${file} must not fake page visibility`);
    assert.doesNotMatch(source, /webkitvisibilitychange|visibilitychange['"]\s*,\s*function\s*\(\s*e?\s*\)\s*\{\s*e\.stopImmediatePropagation/, `${file} must not swallow visibility events`);
  }
});

test('the Media tab offers Listen next to Watch and the player offers Listen instead', () => {
  const media = read('app/(tabs)/messages.tsx');
  assert.match(media, /function listenToSermon\(sermon: Sermon\)[\s\S]*?type: 'audio'/);
  assert.match(media, /audioUrl: listen && listen !== target \? listen : undefined/);
  assert.match(media, /accessibilityLabel=\{`Listen to \$\{sermon\.title\}\. Keeps playing when your screen is off\.`\}/);
  assert.match(media, /\{ name: 'listen', label: 'Listen\. Keeps playing when your screen is off\.' \}/);
  const player = read('lib/nowPlaying.tsx');
  assert.match(player, /isEmbed && item\?\.audioUrl \?/);
  assert.match(player, />Listen instead</);
  assert.match(player, /numberOfLines=\{2\} maxFontSizeMultiplier=\{1\.3\} style=\{styles\.miniNotice\}>\{YOUTUBE_SCREEN_OFF_NOTICE\}/);
});

test('the build still asks for background playback (resolved config checked with expo config --type introspect)', () => {
  const app = JSON.parse(read('app.json'));
  const plugins = app.expo.plugins.map((p) => (Array.isArray(p) ? p : [p, {}]));
  const audio = plugins.find(([name]) => name === 'expo-audio');
  const video = plugins.find(([name]) => name === 'expo-video');
  assert.ok(audio, 'expo-audio plugin');
  assert.notEqual(audio[1].enableBackgroundPlayback, false);
  assert.equal(video?.[1]?.supportsBackgroundPlayback, true);
});

test('the two songs are posted as published music with covers in the public bucket', () => {
  const sql = read('supabase/2026-09-22-media-owner-songs.sql');
  const base = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/';
  for (const [title, artist, slug, file, cover] of [
    ['The YHWH Power Chant', 'Prophet Joshua Matthews', 'the-yhwh-power-chant', 'the-yhwh-power-chant.m4a', 'the-yhwh-power-chant-cover.jpg'],
    ['Resilience', 'JC Jacobs', 'resilience-jc-jacobs', 'resilience-jc-jacobs.mp3', 'resilience-jc-jacobs-cover.jpg'],
  ]) {
    assert.ok(sql.includes(`'${title}'`), title);
    assert.ok(sql.includes(`'${artist}'`), artist);
    assert.ok(sql.includes(`'${slug}'`), slug);
    assert.ok(sql.includes(`${base}${file}`), file);
    assert.ok(sql.includes(`${base}${cover}`), cover);
    assert.equal(embed.fileKind(`${base}${file}`), 'audio', `${file} plays natively, so it keeps going with the screen off`);
  }
  assert.equal((sql.match(/\('music',/g) || []).length, 2);
  assert.match(sql, /on conflict \(slug\) do update/);
  // The one-off importer is retired: it only ever answers 410 Gone now.
  const stub = read('supabase/functions/import-owner-songs/index.ts');
  assert.match(stub, /status: 410/);
  assert.doesNotMatch(stub, /SERVICE_ROLE|storage\/v1\/object/);
});
