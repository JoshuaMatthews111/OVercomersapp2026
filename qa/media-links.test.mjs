// Media links (2026-09-23), for the owner's TestFlight 36 notes:
//   "make sure in future we can use supabase links or firebase [for media]"
//   "youtube definitely stops playing once i leave the app, fix this."
//
// Two pure things are checked here:
//   1. classifyMediaLink — the one answer the player and the paste-a-link form
//      share about a pasted link: play it as a file, in a web view, or refuse
//      it with a sentence a leader can act on.
//   2. The YouTube resume positions — YouTube pauses its own player when the
//      app leaves the front and no app may change that, so the app remembers
//      where the person was and starts there when they come back.
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

const embed = load('lib/embed.ts', { fetchWithTimeout: async () => ({ ok: false }) });

const YT = 'https://youtu.be/G5h7XID3Re8';
const SUPA = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/the-yhwh-power-chant.mp3';
const SUPA_SIGNED = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/sign/sermon-media/music/resilience.m4a?token=eyJhbGciOiJIUzI1NiJ9.abc.def&download=Resilience.m4a';
const FIREBASE = 'https://firebasestorage.googleapis.com/v0/b/ogn-app.appspot.com/o/sermons%2F2026-09-21%20Sunday%20Service.mp3?alt=media&token=6b1f0e2a-0000-4000-8000-0123456789ab';

// ---------------------------------------------------------------------------
// Reading the file name out of a link
// ---------------------------------------------------------------------------

test('a Supabase or Firebase link is read as the file it really points at', () => {
  assert.equal(embed.fileKind(SUPA), 'audio');
  assert.equal(embed.fileKind(SUPA_SIGNED), 'audio', 'a signed link ends in a token, not in .m4a');
  assert.equal(embed.fileKind(FIREBASE), 'audio', 'Firebase hides the path inside %2F escapes');
  assert.equal(embed.fileKind('https://firebasestorage.googleapis.com/v0/b/ogn-app.appspot.com/o/media%2Fservice.mp4?alt=media'), 'video');
});

test('the query string and the #fragment never decide what a link is', () => {
  assert.equal(embed.fileKind('https://cdn.example.org/a.mp3#t=90'), 'audio');
  assert.equal(embed.fileKind('https://cdn.example.org/a.mp4?download=Sunday%20Service.mp4'), 'video');
  // A page whose address merely mentions a file name is not a file.
  assert.equal(embed.fileKind('https://example.org/player?file=song.mp3'), null);
  assert.equal(embed.fileKind('https://example.org/watch/video.mp4/share'), null);
});

test('the file name a leader would recognise comes back out of the link', () => {
  assert.equal(embed.mediaFileName(FIREBASE), '2026-09-21 Sunday Service.mp3');
  assert.equal(embed.mediaFileName(SUPA), 'the-yhwh-power-chant.mp3');
  assert.equal(embed.mediaFileName(YT), null);
});

test('nothing in here throws on a link that is not a link', () => {
  for (const bad of ['', '   ', 'not a link', 'https://', 'https://%%%/a.mp3', 'mailto:pastor@example.org']) {
    assert.doesNotThrow(() => embed.fileKind(bad));
    assert.doesNotThrow(() => embed.mediaFileName(bad));
    assert.doesNotThrow(() => embed.classifyMediaLink(bad));
  }
});

// ---------------------------------------------------------------------------
// classifyMediaLink — the answer the paste-a-link form shows
// ---------------------------------------------------------------------------

test('an uploaded file plays in the app and keeps playing with the screen off', () => {
  const song = embed.classifyMediaLink(SUPA);
  assert.equal(song.kind, 'audio');
  assert.equal(song.how, 'file');
  assert.equal(song.host, 'supabase');
  assert.equal(song.keepsPlayingWithScreenOff, true);
  assert.equal(song.problem, null);
  assert.match(song.note, /keeps playing when the screen is off/);

  const firebase = embed.classifyMediaLink(FIREBASE);
  assert.equal(firebase.host, 'firebase');
  assert.equal(firebase.kind, 'audio');
  assert.equal(firebase.keepsPlayingWithScreenOff, true);
});

test('a YouTube link is honest about stopping when the person leaves the app', () => {
  const link = embed.classifyMediaLink(YT);
  assert.equal(link.kind, 'embed');
  assert.equal(link.how, 'embed');
  assert.equal(link.host, 'youtube');
  assert.equal(link.keepsPlayingWithScreenOff, false);
  assert.match(link.note, /pauses when the person leaves the app/);
  assert.equal(link.problem, null);
});

test('a link that cannot be used says what to do instead, and is never "playable"', () => {
  assert.match(embed.classifyMediaLink('').problem, /Paste a link first/);
  assert.match(embed.classifyMediaLink('https://youtu be/abc').problem, /space in it/);
  assert.match(embed.classifyMediaLink('http://cdn.example.org/a.mp3').problem, /not secure/);
  assert.match(embed.classifyMediaLink('https://www.youtube.com/@overcomersglobalnetwork').problem, /does not point to one video/);
  assert.match(embed.classifyMediaLink('https://example.org/some/page').problem, /could not tell what that link is/);
  for (const bad of ['', 'http://cdn.example.org/a.mp3', 'https://example.org/some/page']) {
    assert.equal(embed.classifyMediaLink(bad).how, null);
    assert.equal(embed.classifyMediaLink(bad).keepsPlayingWithScreenOff, false);
  }
});

test('an uploaded file with no ending in its name still plays when the caller says what it is', () => {
  const noExtension = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/8f2c1a90-0e21-4a55-9b0c-0d0f1b2c3d4e?token=x';
  assert.match(embed.classifyMediaLink(noExtension).problem, /could not tell what kind of file/);
  const told = embed.classifyMediaLink(noExtension, 'audio');
  assert.equal(told.kind, 'audio');
  assert.equal(told.how, 'file');
  assert.equal(told.keepsPlayingWithScreenOff, true);
  assert.equal(told.problem, null);
});

test('classifyMediaLink and playbackKind never disagree about a link', () => {
  for (const url of [SUPA, SUPA_SIGNED, FIREBASE, YT, 'https://vimeo.com/76979871', 'https://cdn.example.org/a.mp4']) {
    const classified = embed.classifyMediaLink(url);
    assert.equal(classified.kind, embed.playbackKind(url, 'audio'), url);
  }
});

// ---------------------------------------------------------------------------
// Coming back to the same place in a YouTube video
// ---------------------------------------------------------------------------

const ID = 'G5h7XID3Re8';
const OTHER = 'AAAAAAAAAAA';

test('the page reports where the video got to, and anything else is ignored', () => {
  assert.deepEqual(
    embed.parsePlayerMessage('{"source":"ogn-player","type":"time","seconds":91.4,"duration":3600.9}'),
    { type: 'time', seconds: 91, duration: 3600 },
  );
  assert.deepEqual(
    embed.parsePlayerMessage('{"source":"ogn-player","type":"time","seconds":40}'),
    { type: 'time', seconds: 40, duration: 0 },
    'a live stream has no duration',
  );
  assert.equal(embed.parsePlayerMessage('{"source":"ogn-player","type":"time","seconds":"90"}'), null);
  assert.equal(embed.parsePlayerMessage('{"source":"ogn-player","type":"time","seconds":-5}'), null);
  assert.equal(embed.parsePlayerMessage('{"type":"time","seconds":90}'), null, 'not from our page');
});

test('a position is only kept when it is worth coming back to', () => {
  const after10s = embed.rememberPosition({}, ID, 10, 3600);
  assert.deepEqual(after10s, {}, 'ten seconds in, starting again from the top is kinder');

  const midway = embed.rememberPosition({}, ID, 245, 3600);
  assert.equal(midway[ID], 245);
  assert.equal(embed.resumeStartSeconds(midway, ID), 245);

  // Watched to the end: the next tap plays it from the top, not from the credits.
  const finished = embed.rememberPosition(midway, ID, 3595, 3600);
  assert.equal(finished[ID], undefined);
  assert.equal(embed.resumeStartSeconds(finished, ID), 0);
});

test('a live stream (no duration) is remembered, and only real video ids are', () => {
  const live = embed.rememberPosition({}, ID, 600, 0);
  assert.equal(live[ID], 600);
  assert.deepEqual(embed.rememberPosition({}, 'not-an-id', 600, 0), {}, 'never store a made-up id');
  assert.equal(embed.resumeStartSeconds({ [ID]: 600 }, null), 0);
  assert.equal(embed.resumeStartSeconds({}, ID), 0, 'nothing stored means start at the top');
});

test('only the last few videos are remembered, newest first', () => {
  let positions = {};
  for (let i = 0; i < embed.RESUME_MAX + 4; i += 1) {
    const id = `vid${String(i).padStart(8, '0')}`.slice(0, 11);
    positions = embed.rememberPosition(positions, id, 100 + i, 3600);
  }
  assert.equal(Object.keys(positions).length, embed.RESUME_MAX);
});

test('positions saved on the phone are read back, and rubbish is treated as nothing', () => {
  const saved = JSON.stringify({ [ID]: 245, [OTHER]: 'later', 'not-an-id': 10, bad: -4 });
  assert.deepEqual(embed.parseResumePositions(saved), { [ID]: 245 });
  assert.deepEqual(embed.parseResumePositions(null), {});
  assert.deepEqual(embed.parseResumePositions('not json'), {});
  assert.deepEqual(embed.parseResumePositions('[1,2,3]'), {});
});

test('the player page is built to start where the person left off', () => {
  const fromTop = embed.youtubePlayerFrameUrl(ID);
  assert.doesNotMatch(fromTop, /[?&]start=/, 'a fresh video starts at the top');
  const resumed = embed.youtubePlayerFrameUrl(ID, embed.PLAYER_ORIGIN, 245);
  assert.match(resumed, /[?&]start=245(&|$)/);
  assert.match(embed.youtubePlayerHtml(ID, { startSeconds: 245.9 }), /[?&]start=245/);
  assert.equal(embed.embedSource(`https://youtu.be/${ID}`, { startSeconds: 245 }).html.includes('start=245'), true);
  // The page tells the app where it is, so the position can be kept at all.
  assert.match(embed.youtubePlayerHtml(ID), /type: 'time'/);
  assert.match(embed.resumeText(245), /^Carrying on from 4:05$/);
  assert.equal(embed.resumeText(5), '', 'nothing to say about five seconds');
});

// ---------------------------------------------------------------------------
// What the person is told about YouTube pausing
// ---------------------------------------------------------------------------

test('the one-time note only points at Listen when there really is a Listen', () => {
  assert.equal(embed.screenOffNoticeText(false), `${embed.YOUTUBE_SCREEN_OFF_NOTICE}.`);
  assert.equal(embed.screenOffNoticeText(true), `${embed.YOUTUBE_SCREEN_OFF_NOTICE}. Tap Listen for the audio version.`);
  assert.equal(embed.YOUTUBE_LISTEN_HINT, 'Tap Listen for the audio version.');
});

test('the full player offers Listen for a teaching that has an audio copy', () => {
  const player = readFileSync(new URL('../lib/nowPlaying.tsx', import.meta.url), 'utf8');
  assert.match(player, /isEmbed && item\?\.audioUrl \?/, 'Listen instead is drawn from the item\'s own audio file');
  assert.match(player, /screenOffNoticeText\(Boolean\(item\?\.audioUrl\)\)/);
  assert.match(player, /startSeconds: resumeAt/, 'the embedded page is built with the remembered position');
  assert.match(player, /message\.type === 'time'/, 'the position is taken from the page');
  // Never spoof YouTube into the background (DO-NOT-BREAK #17, #24).
  assert.doesNotMatch(player, /staysActiveInBackground[^\n]*embed/i);
});

// ---------------------------------------------------------------------------
// Adversarial review, 2026-09-23
// ---------------------------------------------------------------------------

test('a page on YouTube, Vimeo or Facebook is a player, even when its address ends in .mp4', () => {
  // Found in review: "…/videos/123/clip.mp4" was read as a downloadable video
  // file, so the form promised a leader "keeps playing when the screen is off"
  // for a link the native player cannot open at all.
  for (const url of [
    'https://www.facebook.com/overcomersglobalnetwork/videos/123/clip.mp4',
    'https://fb.watch/abc123/clip.mp4',
    'https://vimeo.com/76979871/preview.mp4',
  ]) {
    const told = embed.classifyMediaLink(url);
    assert.equal(told.kind, 'embed', url);
    assert.equal(told.how, 'embed', url);
    assert.equal(told.keepsPlayingWithScreenOff, false, url);
    assert.match(told.note, /pauses when the person leaves the app/);
    // The player must make the same call, or the form and the player disagree.
    assert.equal(embed.playbackKind(url, 'video'), 'embed', url);
  }
  // Uploaded files are untouched: they are still files.
  assert.equal(embed.classifyMediaLink(SUPA).kind, 'audio');
  assert.equal(embed.classifyMediaLink(FIREBASE).kind, 'audio');
  assert.equal(embed.playbackKind('https://cdn.example.org/a.mp4', 'audio'), 'video');
});

test('a query string is never mistaken for a file name', () => {
  const told = embed.classifyMediaLink('https://example.com/watch?file=video.mp4');
  assert.equal(told.kind, 'unknown');
  assert.equal(told.how, null);
  assert.ok(told.problem, 'it says why, in plain words');
  assert.equal(embed.mediaFileName('https://example.com/watch?file=video.mp4'), null);
});
