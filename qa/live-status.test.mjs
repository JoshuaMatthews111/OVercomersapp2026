// Live streaming (2026-09-22): is the ministry live on YouTube, what a phone
// shows, and what a leader's Go live / End live may write.
//
// The two HTML fixtures are real YouTube pages captured on 2026-09-22 and
// trimmed (qa/fixtures/youtube-live-*.html). The first is the ministry's own
// /live page while NOT live — and it still contains `"isLive":true`, which is
// the trap a plain text search falls into.
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

const logic = load('supabase/functions/live-status/logic.ts');
class FriendlyError extends Error {}
const live = load('lib/liveService.ts', {
  ...logic,
  require: () => logic,
  FriendlyError,
  friendlyError: (err, fallback) => (err instanceof FriendlyError ? err.message : fallback),
  hasSupabase: false,
  supabase: {},
  useFocusEffect() {}, useCallback: (f) => f, useEffect() {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}],
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
});

const NOT_LIVE_PAGE = read('qa/fixtures/youtube-live-ogn-channel-not-live.html');
const LIVE_PAGE = read('qa/fixtures/youtube-live-stream-live.html');
const LOFI_CHANNEL = 'UCSJ4gkVC6NrvII8umztf0Ow';
const NOW = Date.parse('2026-09-22T15:00:00Z');
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function playerPage(player, extra = '') {
  return `<!DOCTYPE html><html><head><link rel="canonical" href="https://www.youtube.com/watch?v=${player.videoDetails?.videoId || 'AAAAAAAAAAA'}"></head><body>${' '.repeat(200)}<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>${extra}</body></html>`;
}

// ---------------------------------------------------------------------------
// Reading YouTube's page
// ---------------------------------------------------------------------------

test('the ministry /live page while NOT live is read as scheduled, not live — despite "isLive":true on it', () => {
  assert.match(NOT_LIVE_PAGE, /"isLive":true/, 'the trap is really in the page');
  const found = logic.parseYouTubeLivePage(NOT_LIVE_PAGE);
  assert.equal(found.state, 'scheduled');
  assert.equal(found.videoId, 'NH5dJesdcAw');
  assert.equal(found.channelId, logic.OGN_CHANNEL_ID);
  assert.equal(found.title, 'Prayer & Prophecy');
});

test('a real live stream page is read as live', () => {
  const found = logic.parseYouTubeLivePage(LIVE_PAGE, LOFI_CHANNEL);
  assert.equal(found.state, 'live');
  assert.equal(found.videoId, '3PFJ9SETS4M');
  assert.match(found.title, /lofi house radio/);
});

test('a live page from some other channel never makes the ministry live', () => {
  const found = logic.parseYouTubeLivePage(LIVE_PAGE);
  assert.equal(found.state, 'offline');
  assert.match(found.reason, /different channel/);
});

test('a channel page with no stream at all is offline', () => {
  const page = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${logic.OGN_CHANNEL_ID}"></head><body>${'x'.repeat(400)}<script>var ytInitialData = {"contents":{}};</script></body></html>`;
  assert.equal(logic.parseYouTubeLivePage(page).state, 'offline');
});

test('a cookie-consent page or an empty reply is unsure, never live', () => {
  assert.equal(logic.parseYouTubeLivePage(`<html><form action="https://consent.youtube.com/save">${'x'.repeat(300)}</form></html>`).state, 'unsure');
  assert.equal(logic.parseYouTubeLivePage('').state, 'unsure');
});

test('older page shape: liveBroadcastDetails.isLiveNow with a start time', () => {
  const page = playerPage({
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'G5h7XID3Re8', title: 'Sunday Service', channelId: logic.OGN_CHANNEL_ID, isLiveContent: true },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true, startTimestamp: '2026-09-20T14:02:11+00:00' } } },
  });
  const found = logic.parseYouTubeLivePage(page);
  assert.equal(found.state, 'live');
  assert.equal(found.startedAt, '2026-09-20T14:02:11.000Z');
});

test('a stream that has ended is offline even if a live flag lingers', () => {
  const page = playerPage({
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'G5h7XID3Re8', title: 'Sunday Service', channelId: logic.OGN_CHANNEL_ID, isLiveContent: true },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true, startTimestamp: '2026-09-20T14:02:11+00:00', endTimestamp: '2026-09-20T16:40:00+00:00' } } },
  });
  assert.equal(logic.parseYouTubeLivePage(page).state, 'offline');
});

test('when YouTube withholds the player from a server, the watch-page header decides, else unsure', () => {
  const player = { playabilityStatus: { status: 'LOGIN_REQUIRED' }, videoDetails: { videoId: 'G5h7XID3Re8', channelId: logic.OGN_CHANNEL_ID } };
  const header = (dateText, count) => `<script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ videoPrimaryInfoRenderer: { viewCount: { videoViewCountRenderer: { viewCount: { runs: [{ text: count }] }, isLive: true } }, dateText: { simpleText: dateText } } }] } } } } })};</script>`;
  assert.equal(logic.parseYouTubeLivePage(playerPage(player, header('Started streaming 12 minutes ago', '41 watching now'))).state, 'live');
  assert.equal(logic.parseYouTubeLivePage(playerPage(player, header('Scheduled for Sep 27, 2026', '1 waiting'))).state, 'scheduled');
  assert.equal(logic.parseYouTubeLivePage(playerPage(player)).state, 'unsure');
});

test('the JSON reader is not fooled by braces and quotes inside a title', () => {
  const html = 'var ytInitialPlayerResponse = {"videoDetails":{"title":"God is {good} \\"always\\" }}"}};var x = 1;';
  assert.equal(logic.extractAssignedJson(html, 'ytInitialPlayerResponse').videoDetails.title, 'God is {good} "always" }}');
  assert.equal(logic.extractAssignedJson('nothing here', 'ytInitialPlayerResponse'), null);
});

// ---------------------------------------------------------------------------
// Links a leader pastes
// ---------------------------------------------------------------------------

test('YouTube and Facebook live links are accepted; anything else is refused in plain words', () => {
  const yt = logic.classifyLiveLink('https://youtube.com/live/G5h7XID3Re8?feature=share');
  assert.deepEqual(yt, { ok: true, source: 'youtube', url: 'https://www.youtube.com/watch?v=G5h7XID3Re8', videoId: 'G5h7XID3Re8' });
  assert.equal(logic.classifyLiveLink('youtu.be/G5h7XID3Re8').ok, true, 'no https:// typed');
  assert.equal(logic.classifyLiveLink('http://m.youtube.com/watch?v=G5h7XID3Re8&t=5').url, 'https://www.youtube.com/watch?v=G5h7XID3Re8');
  const fb = logic.classifyLiveLink('https://www.facebook.com/overcomersglobalnetwork/videos/1234567890');
  assert.equal(fb.ok, true);
  assert.equal(fb.source, 'facebook');
  assert.equal(logic.classifyLiveLink('https://fb.watch/abc123/').source, 'facebook');
  for (const bad of ['', 'https://vimeo.com/123', 'https://www.youtube.com/@overcomersglobalnetwork', 'javascript:alert(1)//facebook.com/', 'https://youtu.be/G5h7XID3Re8 https://youtu.be/G5h7XID3Re8', 'https://facebook.com.evil.example/x']) {
    const result = logic.classifyLiveLink(bad);
    assert.equal(result.ok, false, bad);
    assert.ok(result.message.length > 10, bad);
    assert.doesNotMatch(result.message, /null|undefined|regex|url/i, bad);
  }
});

test('the edge function and the app agree on every YouTube link shape lib/embed.ts knows', () => {
  const embed = load('lib/embed.ts', { fetchWithTimeout: () => Promise.reject(new Error('offline')) });
  const shapes = [
    'https://youtu.be/G5h7XID3Re8',
    'https://youtu.be/G5h7XID3Re8?is=4DKloCQczdogCpo7',
    'https://www.youtube.com/watch?v=G5h7XID3Re8&t=90s',
    'https://m.youtube.com/watch?v=G5h7XID3Re8',
    'https://www.youtube.com/live/G5h7XID3Re8',
    'https://www.youtube.com/shorts/G5h7XID3Re8',
    'https://www.youtube.com/embed/G5h7XID3Re8',
    'https://www.youtube.com/v/G5h7XID3Re8',
    'https://www.youtube-nocookie.com/embed/G5h7XID3Re8',
    'https://www.youtube.com/watch?v=G5h7XID3Re8https://www.youtube.com/watch?v=G5h7XID3Re8',
    'https://www.youtube.com/@overcomersglobalnetwork',
  ];
  for (const url of shapes) assert.equal(logic.youtubeIdFromLink(url), embed.youtubeVideoId(url), url);
});

// ---------------------------------------------------------------------------
// The row and what every phone is told
// ---------------------------------------------------------------------------

const autoLive = { is_live: true, video_id: 'G5h7XID3Re8', title: 'Sunday Service', started_at: iso(-20 * MIN), checked_at: iso(-30_000), confirmed_at: iso(-30_000), detail: 'live: YouTube says this stream is live now' };

test('YouTube live is shown, with a watch link the in-app player plays', () => {
  const state = logic.resolveLiveState(autoLive, NOW);
  assert.equal(state.isLive, true);
  assert.equal(state.via, 'youtube');
  assert.equal(state.url, 'https://www.youtube.com/watch?v=G5h7XID3Re8');
  assert.deepEqual(live.watchActionFor(state), { kind: 'in-app', url: 'https://www.youtube.com/watch?v=G5h7XID3Re8', title: 'Sunday Service', speaker: live.LIVE_SPEAKER });
});

test('a live answer nobody has confirmed for ten minutes is not believed', () => {
  const state = logic.resolveLiveState({ ...autoLive, confirmed_at: iso(-11 * MIN) }, NOW);
  assert.equal(state.isLive, false);
});

test('a leader\'s Go live wins, ends itself when it expires, and Facebook opens outside the app', () => {
  const override = { mode: 'live', source: 'facebook', url: 'https://www.facebook.com/ogn/videos/123', video_id: null, title: 'Bible Study', set_at: iso(-5 * MIN), expires_at: iso(7 * HOUR) };
  const state = logic.resolveLiveState({ is_live: false, manual_override: override }, NOW);
  assert.equal(state.isLive, true);
  assert.equal(state.via, 'manual');
  assert.deepEqual(live.watchActionFor(state), { kind: 'open', url: 'https://www.facebook.com/ogn/videos/123', where: 'facebook' });
  assert.equal(logic.resolveLiveState({ is_live: false, manual_override: { ...override, expires_at: iso(-1) } }, NOW).isLive, false);
  // A stored override with a link the database would never accept is ignored.
  assert.equal(logic.resolveLiveState({ manual_override: { ...override, url: 'javascript:alert(1)' } }, NOW).isLive, false);
});

test('End live hides that one YouTube stream, not the next one', () => {
  const ended = { mode: 'ended', video_id: 'G5h7XID3Re8', set_at: iso(-MIN), expires_at: iso(11 * HOUR) };
  assert.equal(logic.resolveLiveState({ ...autoLive, manual_override: ended }, NOW).isLive, false);
  assert.equal(logic.resolveLiveState({ ...autoLive, video_id: 'ZZZZZZZZZZZ', manual_override: ended }, NOW).isLive, true);
  // What End live writes, depending on what is on.
  const onAuto = logic.resolveLiveState(autoLive, NOW);
  assert.deepEqual(live.endLiveOverride(onAuto), { mode: 'ended', video_id: 'G5h7XID3Re8' });
  const manualOnly = logic.resolveLiveState({ manual_override: { mode: 'live', source: 'youtube', url: 'https://youtu.be/AAAAAAAAAAA', video_id: 'AAAAAAAAAAA', expires_at: iso(HOUR) } }, NOW);
  assert.equal(live.endLiveOverride(manualOnly), null);
});

test('one unclear answer from YouTube never flips the app; clear answers do', () => {
  const unsure = { state: 'unsure', reason: 'could not reach YouTube', videoId: null, title: null, channelId: null, startedAt: null };
  const kept = logic.detectionColumns(autoLive, unsure, iso(0));
  assert.equal(kept.is_live, true);
  assert.equal(kept.video_id, 'G5h7XID3Re8');
  assert.equal(kept.confirmed_at, autoLive.confirmed_at, 'not re-confirmed');
  assert.match(kept.detail, /^unsure:/);

  const sameStream = logic.detectionColumns(autoLive, { state: 'live', reason: 'x', videoId: 'G5h7XID3Re8', title: 'Sunday Service', channelId: null, startedAt: null }, iso(0), 'Sunday Service (oEmbed)');
  assert.equal(sameStream.started_at, autoLive.started_at, 'the start time stays with the stream');
  assert.equal(sameStream.title, 'Sunday Service (oEmbed)');

  const newStream = logic.detectionColumns(autoLive, { state: 'live', reason: 'x', videoId: 'ZZZZZZZZZZZ', title: 'Bible Study', channelId: null, startedAt: null }, iso(0));
  assert.equal(newStream.started_at, null, 'reviewer 2026-09-22: never invent "now" as the start; the first check can be long after the service began');
  const toldStart = logic.detectionColumns(autoLive, { state: 'live', reason: 'x', videoId: 'ZZZZZZZZZZZ', title: 'Bible Study', channelId: null, startedAt: iso(-35 * MIN) }, iso(0));
  assert.equal(toldStart.started_at, iso(-35 * MIN));

  const off = logic.detectionColumns(autoLive, { state: 'scheduled', reason: 'waiting', videoId: 'NH5dJesdcAw', title: 'Prayer & Prophecy', channelId: null, startedAt: null }, iso(0));
  assert.equal(off.is_live, false);
  assert.equal(logic.resolveLiveState({ ...off }, NOW).isLive, false);
  assert.equal(logic.resolveLiveState({ ...off }, NOW).detection, 'scheduled');
});

test('the cache: YouTube is asked again only after a minute', () => {
  assert.equal(logic.rowNeedsRefresh({ checked_at: iso(-30_000) }, NOW), false);
  assert.equal(logic.rowNeedsRefresh({ checked_at: iso(-61_000) }, NOW), true);
  assert.equal(logic.rowNeedsRefresh({ checked_at: null }, NOW), true);
  assert.equal(logic.rowNeedsRefresh(null, NOW), true);
});

test('a phone checks the edge function reply before trusting it', () => {
  assert.equal(logic.normalizeLiveState(null), null);
  assert.equal(logic.normalizeLiveState({ error: 'x' }), null);
  assert.equal(logic.normalizeLiveState({ isLive: true, source: 'youtube', url: 'https://evil.example/x' }), null);
  const ok = logic.normalizeLiveState(logic.resolveLiveState(autoLive, NOW));
  assert.equal(ok.isLive, true);
  assert.equal(ok.videoId, 'G5h7XID3Re8');
  assert.equal(logic.normalizeLiveState({ isLive: false }).isLive, false);
});

// ---------------------------------------------------------------------------
// The app side
// ---------------------------------------------------------------------------

test('Notify everyone sends "We\'re live" with {live:true}; routing does not special-case it (yet)', () => {
  const payload = live.livePushPayload('Sunday Service');
  assert.equal(payload.title, "We're live");
  assert.equal(payload.body, 'Sunday Service. Tap to watch in the app.');
  assert.deepEqual(payload.data, { live: true });
  assert.equal(payload.category, 'announcements', 'members who turned announcements off are respected');
  assert.equal(live.livePushPayload('').body, 'Join us now. Tap to watch in the app.');
  const Notifications = { useLastNotificationResponse: () => null, DEFAULT_ACTION_IDENTIFIER: 'default' };
  const { notificationTarget } = load('lib/notificationRouting.ts', {
    Notifications, router: { push() {} }, useEffect() {}, useRef: () => ({ current: null }), Platform: { OS: 'ios' },
  });
  // No chat room, no announcement: the app opens where it is (Home, with the live card).
  assert.equal(notificationTarget({ ...payload.data, category: 'announcements' }), null);
});

test('Go live refuses a bad link before anything is written', () => {
  assert.throws(() => live.goLiveOverride('https://vimeo.com/1', ''), FriendlyError);
  assert.throws(() => live.goLiveOverride('https://youtu.be/G5h7XID3Re8', 'x'.repeat(141)), FriendlyError);
  assert.deepEqual(live.goLiveOverride(' youtu.be/G5h7XID3Re8 ', ' Sunday Service '), {
    mode: 'live', source: 'youtube', url: 'https://www.youtube.com/watch?v=G5h7XID3Re8', video_id: 'G5h7XID3Re8', title: 'Sunday Service',
  });
  assert.equal(live.liveWriteProblem({ code: '22023', message: 'That is not a Facebook link.' }), 'That is not a Facebook link.');
  assert.match(live.liveWriteProblem({ code: '42501', message: 'permission denied for table live_status' }), /Only leaders/);
});

test('the not-live schedule: the next Sunday Service and Bible Study, weekly ones stepped forward', () => {
  const rows = [
    { id: 'a', title: 'Sunday Service', starts_at: '2026-08-02T14:00:00Z', recurrence: 'weekly', status: 'scheduled', published: true },
    { id: 'b', title: 'Bible Study', starts_at: '2026-09-23T23:30:00Z', recurrence: 'none', status: 'scheduled', published: true },
    { id: 'c', title: 'Bible Study', starts_at: '2026-09-30T23:30:00Z', recurrence: 'none', status: 'scheduled', published: true },
    { id: 'd', title: 'Youth Picnic', starts_at: '2026-09-24T16:00:00Z', recurrence: 'none', status: 'scheduled', published: true },
    { id: 'e', title: 'Sunday Service (moved)', starts_at: '2026-09-24T16:00:00Z', recurrence: 'none', status: 'cancelled', published: true },
    { id: 'f', title: 'Worship Night draft', starts_at: '2026-09-25T00:00:00Z', recurrence: 'none', status: 'scheduled', published: false },
    { id: 'g', title: 'Sunday Service', starts_at: '2027-01-01T14:00:00Z', recurrence: 'none', status: 'scheduled', published: true },
  ];
  const picked = live.pickServiceTimes(rows, NOW);
  assert.deepEqual(picked.map((p) => p.id), ['b', 'a']);
  const sunday = picked.find((p) => p.id === 'a');
  assert.equal(sunday.weekly, true);
  const next = new Date(sunday.startsAt);
  assert.ok(next.getTime() > NOW - 3 * HOUR && next.getTime() - NOW < 7 * 24 * HOUR, 'the next Sunday, within a week');
  assert.equal(next.getDay(), new Date('2026-08-02T14:00:00Z').getDay(), 'still a Sunday');
  assert.equal(next.getHours(), new Date('2026-08-02T14:00:00Z').getHours(), 'still the same local hour');
  assert.deepEqual(live.pickServiceTimes([], NOW), []);
});

test('screen copy stays honest about locked phones and never promises lock-screen listening', () => {
  const screen = read('app/live.tsx');
  assert.match(screen, /Keep the app open to keep watching\. The stream stops if you lock your phone or switch to another app\./);
  assert.doesNotMatch(screen, /lock-screen listening is coming|coming soon/i);
  const banner = read('components/LiveBanner.tsx');
  assert.match(banner, /if \(!canManageLive \|\| !state\) return null;/, 'members see nothing when not live');
  assert.match(banner, /state\.isLive \? \(/, 'the LIVE pill only draws when live');
});

test('the live screen is signed-in only, and Admin stays five rows', () => {
  const layout = read('app/_layout.tsx');
  const protectedBlock = layout.slice(layout.indexOf('<Stack.Protected'), layout.indexOf('</Stack.Protected>'));
  assert.match(protectedBlock, /<Stack\.Screen name="live" \/>/);
  const outside = layout.slice(0, layout.indexOf('<Stack.Protected'));
  assert.doesNotMatch(outside, /name="live"/);
  assert.doesNotMatch(read('app/admin.tsx'), /Go live/);
});

test('the SQL gives members read only and leaders one column', () => {
  const sql = read('supabase/2026-09-22-live-status.sql');
  assert.match(sql, /revoke all on public\.live_status from anon, authenticated;/);
  assert.match(sql, /grant select on public\.live_status to authenticated;/);
  assert.match(sql, /grant update \(manual_override\) on public\.live_status to authenticated;/);
  assert.match(sql, /using \(\(select public\.is_content_publisher\(\)\)\)/);
  assert.match(sql, /interval '8 hours'/);
});

// ---------------------------------------------------------------------------
// Adversarial review, 2026-09-22
// ---------------------------------------------------------------------------

test('review: a Facebook link the database would refuse is refused on the phone first (no user@host spoof)', () => {
  for (const bad of [
    'https://www.facebook.com:443@evil.example/live',
    'https://facebook.com@evil.example/x',
    'https://www.facebook.com',
    'https://fb.watch',
  ]) {
    assert.equal(logic.classifyLiveLink(bad).ok, false, bad);
  }
  // An override row carrying such a link is never shown.
  const row = { manual_override: { mode: 'live', source: 'facebook', url: 'https://www.facebook.com:443@evil.example/x', expires_at: iso(HOUR) } };
  assert.equal(logic.resolveLiveState(row, NOW).isLive, false);
  assert.equal(logic.normalizeLiveState({ isLive: true, source: 'facebook', url: 'https://www.facebook.com:443@evil.example/x' }), null);
  // Still fine: the shapes people actually paste.
  assert.equal(logic.classifyLiveLink('https://www.facebook.com/overcomersglobalnetwork/videos/1234567890').ok, true);
  assert.equal(logic.classifyLiveLink('fb.watch/abc123/').ok, true);
  assert.equal(logic.classifyLiveLink('https://m.facebook.com/watch/live/?v=1').ok, true);
});

test('review: start time comes from YouTube\'s "Started streaming N minutes ago", else it is unknown', () => {
  const header = (dateText) => `<script>var ytInitialData = ${JSON.stringify({ contents: { a: [{ videoPrimaryInfoRenderer: { dateText: { simpleText: dateText } } }] } })};</script>`;
  assert.equal(logic.headerStartedAt(header('Started streaming 35 minutes ago'), NOW), iso(-35 * MIN));
  assert.equal(logic.headerStartedAt(header('Started streaming 2 hours ago'), NOW), iso(-2 * HOUR));
  assert.equal(logic.headerStartedAt(header('Started streaming an hour ago'), NOW), iso(-HOUR));
  assert.equal(logic.headerStartedAt(header('Started streaming on Sep 17, 2026'), NOW), null);
  // The real live fixture says "on Sep 17": no time of day, so no start time and no "Started just now".
  assert.equal(logic.parseYouTubeLivePage(LIVE_PAGE, LOFI_CHANNEL, NOW).startedAt, null);
  const state = logic.resolveLiveState({ ...autoLive, started_at: null }, NOW);
  assert.equal(live.startedText(state.startedAt, NOW), '');
});

test('review: the year-old "Prayer & Prophecy" leftover is named as a leftover for leaders, still not live', () => {
  const found = logic.parseYouTubeLivePage(NOT_LIVE_PAGE, logic.OGN_CHANNEL_ID, NOW);
  assert.equal(found.state, 'scheduled');
  assert.equal(found.reason, logic.OLD_SCHEDULED_REASON);
  const cols = logic.detectionColumns(null, found, iso(0));
  const state = logic.resolveLiveState(cols, NOW);
  assert.equal(state.isLive, false);
  assert.match(live.detectionText(state), /old scheduled stream.*YouTube Studio/);
  // A stream due to start soon is still described as about to start.
  const soon = logic.parseYouTubeLivePage(NOT_LIVE_PAGE, logic.OGN_CHANNEL_ID, Date.parse('2025-07-26T00:40:00Z'));
  assert.equal(soon.reason, 'a stream is scheduled but has not started');
});

test('review: Watch now always goes through play() (which resumes a paused stream), and Go live cannot double-send', () => {
  for (const file of ['app/live.tsx', 'components/LiveBanner.tsx']) {
    const src = read(file);
    assert.doesNotMatch(src, /nowPlaying\.expand\(\)/, `${file}: expand() alone does not resume a paused stream`);
    assert.match(src, /nowPlaying\.play\(\{/, file);
  }
  const screen = read('app/live.tsx');
  assert.match(screen, /if \(working\.current\) return;/);
  assert.doesNotMatch(screen, /every phone that says/, 'members who turned announcements off are not sent it');
  const service = read('lib/liveService.ts');
  assert.match(service, /mine !== generation\.current/, 'an older check never overwrites a newer answer');
});

test('security review: live-status answers signed-in members only, not the public anon key', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims) => `Bearer ${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2ln`;
  const future = Math.floor(Date.now() / 1000) + 3600;
  const uid = '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  assert.equal(logic.signedInCaller(token({ role: 'authenticated', sub: uid, exp: future })), uid);
  assert.equal(logic.signedInCaller(token({ role: 'anon', iss: 'supabase', exp: future })), null, 'the anon key is not a member');
  assert.equal(logic.signedInCaller(token({ role: 'service_role', exp: future })), null);
  assert.equal(logic.signedInCaller(token({ role: 'authenticated', sub: uid, exp: 1000 })), null, 'expired');
  assert.equal(logic.signedInCaller(token({ role: 'authenticated', sub: 'not-a-uuid', exp: future })), null);
  assert.equal(logic.signedInCaller(''), null);
  assert.equal(logic.signedInCaller(null), null);
  assert.equal(logic.signedInCaller('Bearer garbage'), null);
  const index = read('supabase/functions/live-status/index.ts');
  assert.match(index, /if \(!signedInCaller\(req\.headers\.get\('Authorization'\)\)\) return json\(\{ error: 'Please sign in\.' \}, 401\);/);
});

// ---------------------------------------------------------------------------
// "Will the live really appear in the app once streaming?" — 2026-09-23
//
// Checked against the real thing on 2026-09-23 before these tests were
// written: the deployed live-status function (version 5) answered a signed-in
// member 200 with detection "scheduled", note "an old scheduled stream that
// never started is still waiting on YouTube", isLive false — while the same
// parser, run here over the channel page fetched in the same minute, decided
// exactly the same thing. The anon key got 401. What follows pins the rules
// that answer depends on.
// ---------------------------------------------------------------------------

test('a stream YouTube will not let play in another app sends people to YouTube, not to a dead player', () => {
  const embeddingOff = { ...autoLive, embeddable: false };
  const state = logic.resolveLiveState(embeddingOff, NOW);
  assert.equal(state.isLive, true);
  assert.equal(state.embeddable, false);
  const action = live.watchActionFor(state);
  assert.deepEqual(action, { kind: 'open', url: 'https://www.youtube.com/watch?v=G5h7XID3Re8', where: 'youtube' });

  // We only ever say so when YouTube told us. Not knowing keeps the in-app player.
  for (const row of [autoLive, { ...autoLive, embeddable: null }, { ...autoLive, embeddable: 'maybe' }]) {
    const unknown = logic.resolveLiveState(row, NOW);
    assert.equal(unknown.embeddable, row.embeddable === true ? true : null);
    assert.equal(live.watchActionFor(unknown).kind, 'in-app');
  }
  const allowed = logic.resolveLiveState({ ...autoLive, embeddable: true }, NOW);
  assert.equal(live.watchActionFor(allowed).kind, 'in-app');
  // Facebook is unchanged.
  const fb = logic.resolveLiveState({ manual_override: { mode: 'live', source: 'facebook', url: 'https://www.facebook.com/ogn/videos/1', expires_at: iso(HOUR) } }, NOW);
  assert.deepEqual(live.watchActionFor(fb), { kind: 'open', url: 'https://www.facebook.com/ogn/videos/1', where: 'facebook' });
});

test('the embedding answer is written only when YouTube gave one, and an unsure check never wipes it', () => {
  const live1 = { state: 'live', videoId: 'G5h7XID3Re8', title: 'Sunday Service', channelId: logic.OGN_CHANNEL_ID, startedAt: null, reason: 'YouTube says this stream is live now', embeddable: false };
  const cols = logic.detectionColumns(null, live1, iso(0), null);
  assert.equal(cols.embeddable, false);
  assert.equal(cols.is_live, true);

  const unsure = { state: 'unsure', videoId: null, title: null, channelId: null, startedAt: null, reason: 'could not reach YouTube', embeddable: null };
  assert.equal(logic.detectionColumns(cols, unsure, iso(MIN)).embeddable, false, 'one bad fetch does not forget what we knew');

  const offline = { state: 'offline', videoId: null, title: null, channelId: null, startedAt: null, reason: 'the last stream has ended', embeddable: null };
  assert.equal(logic.detectionColumns(cols, offline, iso(2 * MIN)).embeddable, null, 'a finished stream carries nothing forward');

  // The edge function is the only thing that asks, and it asks YouTube's open oEmbed.
  const index = read('supabase/functions/live-status/index.ts');
  assert.match(index, /reply\.status === 401 \|\| reply\.status === 403/);
  assert.match(index, /embeddable: false/);
  assert.match(index, /embeddable: true/);
  assert.match(index, /embeddable,manual_override/, 'the column is read back with the rest of the row');
});

test('a phone never trusts an embedding answer it did not recognise', () => {
  const base = { isLive: true, via: 'youtube', source: 'youtube', videoId: 'G5h7XID3Re8', url: 'https://www.youtube.com/watch?v=G5h7XID3Re8', title: 'Sunday' };
  assert.equal(logic.normalizeLiveState({ ...base, embeddable: false }).embeddable, false);
  assert.equal(logic.normalizeLiveState({ ...base, embeddable: true }).embeddable, true);
  assert.equal(logic.normalizeLiveState({ ...base, embeddable: 'no' }).embeddable, null);
  assert.equal(logic.normalizeLiveState({ ...base }).embeddable, null);
  assert.equal(logic.NOT_LIVE.embeddable, null);
});

test('"Check now" shows a leader exactly what the server last saw, with nothing blank', () => {
  const state = logic.resolveLiveState({ ...autoLive, embeddable: true }, NOW);
  const facts = live.liveFacts(state, NOW);
  const byLabel = Object.fromEntries(facts.map((f) => [f.label, f.value]));
  assert.equal(byLabel['Are we live in the app?'], 'Yes — YouTube is streaming');
  assert.equal(byLabel['Stream title'], 'Sunday Service');
  assert.equal(byLabel['Video id'], 'G5h7XID3Re8');
  assert.match(byLabel['Last checked'], /30 seconds ago \(/);
  assert.match(byLabel['What YouTube said'], /YouTube shows us live/);
  assert.match(byLabel['Plays inside the app?'], /^Yes/);
  for (const fact of facts) assert.ok(fact.value.trim().length > 0, `${fact.label} is never blank`);

  // Not live: the reason is the point of the panel.
  const leftover = logic.resolveLiveState(logic.detectionColumns(null, logic.parseYouTubeLivePage(NOT_LIVE_PAGE, logic.OGN_CHANNEL_ID, NOW), iso(0)), NOW);
  const off = Object.fromEntries(live.liveFacts(leftover, NOW).map((f) => [f.label, f.value]));
  assert.equal(off['Are we live in the app?'], 'No');
  assert.match(off['What YouTube said'], /old scheduled stream that never started/);
  assert.equal(off['Video id'], 'NH5dJesdcAw');
  assert.equal(off['Stream title'], 'Prayer & Prophecy');

  // Nothing known at all still reads as sentences, never "null" or "undefined".
  for (const fact of live.liveFacts(logic.NOT_LIVE, NOW)) {
    assert.doesNotMatch(fact.value, /null|undefined|NaN/, fact.label);
  }
});

test('"Check now" is for leaders only, goes to the server, and keeps the one-minute cache', () => {
  const screen = read('app/live.tsx');
  // The whole panel is behind canManageLive, which is where Check now lives.
  assert.match(screen, /const canManageLive = access\.canManageContent \|\| access\.canManageMedia;/);
  assert.match(screen, /canManageLive && !loading \? \(\s*<LeaderPanel/);
  assert.match(screen, /accessibilityLabel="Check now whether we are live"/);
  assert.match(screen, /onCheckNow=\{checkNow\}/);

  const service = read('lib/liveService.ts');
  assert.match(service, /export async function checkLiveNow/);
  assert.match(service, /supabase\.functions\.invoke\('live-status'/);
  // The cache itself is untouched: one look at YouTube a minute, however many phones ask.
  assert.equal(logic.LIVE_CACHE_MS, 60_000);
  assert.equal(logic.rowNeedsRefresh({ checked_at: iso(-30_000) }, NOW), false);
  assert.equal(logic.rowNeedsRefresh({ checked_at: iso(-61_000) }, NOW), true);
  assert.equal(logic.rowNeedsRefresh(null, NOW), true);
});

test('the embeddable column is additive: members still read the row and write one column', () => {
  const sql = read('supabase/2026-09-23-live-embeddable.sql');
  assert.match(sql, /add column if not exists embeddable boolean/);
  assert.doesNotMatch(sql, /\bgrant\b|\brevoke\b|drop policy|create policy/i, 'the grants and policies are not touched');
});

// ---------------------------------------------------------------------------
// Adversarial review, 2026-09-23. Four things the first build got wrong.
// ---------------------------------------------------------------------------

test('a flaky embedding cross-check never forgets that THIS stream may not be embedded', () => {
  const found = { state: 'live', videoId: 'G5h7XID3Re8', title: 'Sunday Service', channelId: logic.OGN_CHANNEL_ID, startedAt: null, reason: 'YouTube says this stream is live now' };
  // Minute 1: YouTube's oEmbed said no.
  const first = logic.detectionColumns(null, { ...found, embeddable: false }, iso(0), null);
  assert.equal(first.embeddable, false);
  // Minute 2: the same stream, but the cross-check timed out, so it knows nothing.
  const second = logic.detectionColumns(first, { ...found, embeddable: null }, iso(MIN), null);
  assert.equal(second.embeddable, false, 'a timeout must not put the broken in-app player back');
  assert.equal(live.watchActionFor(logic.resolveLiveState({ ...second, confirmed_at: iso(MIN) }, NOW + MIN)).kind, 'open');
  // A clear "yes" later still wins, and so does a different stream starting.
  assert.equal(logic.detectionColumns(second, { ...found, embeddable: true }, iso(2 * MIN), null).embeddable, true);
  const other = logic.detectionColumns(second, { ...found, videoId: 'NH5dJesdcAw', embeddable: null }, iso(3 * MIN), null);
  assert.equal(other.embeddable, null, 'what we knew about one stream says nothing about the next');
});

test('a leader keeps Check now and Go live even when this phone could not read the status', () => {
  const screen = read('app/live.tsx');
  // The panel is rendered off `!loading`, not off a state that may never arrive.
  assert.match(screen, /canManageLive && !loading \? \(/);
  assert.match(screen, /state=\{state \?\? NOT_LIVE\}/);
  assert.match(screen, /unknown=\{!state\}/);
  // And it says so rather than printing "No" as if it were a finding.
  assert.match(screen, /This phone could not read the live status just now/);
  assert.match(screen, /\{unknown \? null : \(/, 'the "what the server last saw" panel is hidden when nothing was read');
  assert.match(screen, /factsOpen && !unknown \?/);
  assert.match(read('lib/liveService.ts'), /export \{[^}]*NOT_LIVE[^}]*\} from/);
});

test("a leader's Check now is never overwritten by a poll that was already in the air", () => {
  const service = read('lib/liveService.ts');
  const checkNow = /const checkNow = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(service);
  assert.ok(checkNow, 'checkNow is still there');
  const awaitAt = checkNow[1].indexOf('await checkLiveNow()');
  const numberAt = checkNow[1].indexOf('++generation.current');
  assert.ok(awaitAt >= 0 && numberAt >= 0);
  assert.ok(numberAt > awaitAt, 'the generation is taken AFTER the answer, so the leader\'s own check wins');
});

test('a live service is watched at the live edge — never rewound to where someone left it', () => {
  const player = read('lib/nowPlaying.tsx');
  // The flag exists, and both places that start a live stream set it.
  assert.match(player, /live\?: boolean;/);
  assert.match(player, /seconds: item\.live \? 0 : resumeStartSeconds/);
  assert.match(player, /const resumeAt = item && item\.type === 'embed' && !item\.live \? resumeForRef\.current\.seconds : 0;/);
  assert.match(player, /const id = item && !item\.live \? youtubeVideoId\(item\.url\) : null;/);
  for (const rel of ['app/live.tsx', 'components/LiveBanner.tsx']) {
    assert.match(read(rel), /type: 'embed', live: true \}\)/, `${rel} marks the live stream as live`);
  }
  // Nothing else claims to be live, so the resume the owner asked for still
  // works everywhere a recording is played.
  assert.doesNotMatch(read('app/chat-room.tsx'), /live: true/);
});
