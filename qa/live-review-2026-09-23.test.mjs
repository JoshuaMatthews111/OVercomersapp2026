// Adversarial review of the live lane, 2026-09-23.
//
// Four things this file holds down, each of them something the code did wrong
// on the day it was reviewed:
//
//   1. The ordinary once-a-minute check threw away the row the edge function
//      had just written and believed the function's REPLY instead. The
//      function is deployed separately from the app, and the copy deployed on
//      2026-09-23 (checked with curl) does not send `endedHideUntil`. So a
//      leader who pressed End live saw "Are we live in the app? No" with no
//      reason and no "Show it again" — the twelve-hour hold DO-NOT-BREAK #52
//      exists to make undoable. Only "Check now" escaped it, because only
//      checkLiveNow re-read the row (#54). Both paths must.
//   2. "What the server last saw" answered questions about the stream that is
//      live now with facts about a DIFFERENT stream — the last one YouTube
//      reported. A hand-started link was told "No — YouTube will not let this
//      one play inside the app" while Watch was plainly playing it inside the
//      app. DO-NOT-BREAK #53: this panel states facts, never guesses.
//   3. The live banner on Home is the ONLY door to /live. It drew nothing at
//      all when the check itself failed, so a leader whose phone could not
//      reach Supabase could not get to Go live — the very screen written for
//      that moment (its own `unknown` branch was unreachable).
//   4. "Live has ended in the app." was said whether or not it had.
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

const NOW = Date.parse('2026-09-23T15:00:00Z');
const MIN = 60_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const VIDEO = 'G5h7XID3Re8';

/**
 * lib/liveService.ts with a fake database. `rows` is read in order: the first
 * read is the cached row, the second is the row the edge function has just
 * written.
 */
function loadService({ rows, reply, replyError = null, readError = false }) {
  const reads = [];
  const invokes = [];
  const queue = rows.slice();
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  reads.push(table);
                  if (readError) return { data: null, error: { message: 'refused' } };
                  return { data: queue.length > 1 ? queue.shift() : queue[0], error: null };
                },
              };
            },
          };
        },
      };
    },
    functions: {
      async invoke(name) {
        invokes.push(name);
        return { data: reply, error: replyError };
      },
    },
  };
  const live = load('lib/liveService.ts', {
    ...logic,
    require: () => logic,
    FriendlyError,
    friendlyError: (err, fallback) => (err instanceof FriendlyError ? err.message : fallback),
    hasSupabase: true,
    supabase,
    useFocusEffect() {}, useCallback: (f) => f, useEffect() {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}],
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  });
  return { live, reads, invokes };
}

/** A row YouTube is reporting live, with a leader's End live holding it down. */
const heldRow = {
  id: 1,
  source: 'youtube',
  video_id: VIDEO,
  url: `https://www.youtube.com/watch?v=${VIDEO}`,
  title: 'Sunday Service',
  is_live: true,
  started_at: iso(-40 * MIN),
  checked_at: iso(-5 * MIN),
  confirmed_at: iso(-5 * MIN),
  detail: 'live: YouTube says this stream is live now',
  embeddable: true,
  manual_override: { mode: 'ended', video_id: VIDEO, set_by: 'u', set_at: iso(-3 * MIN), expires_at: iso(12 * 60 * MIN) },
};

/** What the copy of the function deployed on 2026-09-23 really sends: no endedHideUntil, no lastSeenEmbeddable. */
const oldShapeReply = {
  isLive: false,
  via: null,
  source: null,
  videoId: null,
  url: null,
  title: null,
  startedAt: null,
  checkedAt: iso(0),
  detection: 'live',
  detectionNote: 'YouTube says this stream is live now',
  manualEndsAt: null,
  embeddable: null,
  autoVideoId: null,
  lastSeenVideoId: VIDEO,
  lastSeenTitle: 'Sunday Service',
  channelUrl: logic.OGN_CHANNEL_URL,
};

test('review: the once-a-minute check resolves the row itself, so an older deployed function cannot hide the hold', async () => {
  const fresh = { ...heldRow, checked_at: iso(0), confirmed_at: iso(0) };
  const { live, reads, invokes } = loadService({ rows: [heldRow, fresh], reply: oldShapeReply });
  const state = await live.fetchLiveState(NOW);

  assert.equal(invokes.length, 1, 'a stale row still sends the app to the function');
  assert.equal(reads.length, 2, 'and the row the function just wrote is read back');
  assert.equal(state.isLive, false);
  // The fact the old reply leaves out, and the whole point of the panel.
  assert.equal(state.endedHideUntil, new Date(NOW + 12 * 60 * MIN).toISOString());
  assert.equal(state.lastSeenEmbeddable, true);

  const facts = Object.fromEntries(live.liveFacts(state, NOW).map((f) => [f.label, f.value]));
  assert.match(facts['Is a leader holding it back?'], /someone pressed End live/);
});

test('review: a refused row read still falls back to the function, and then to what we already had', async () => {
  // The read is refused both times; the function's reply is all there is.
  const refused = loadService({ rows: [heldRow], reply: oldShapeReply, readError: true });
  const fromFunction = await refused.live.fetchLiveState(NOW);
  assert.equal(fromFunction.isLive, false);
  assert.equal(fromFunction.lastSeenVideoId, VIDEO);

  // The function cannot be reached: the row we already have still decides, so
  // a hand-started live keeps showing on a phone with a bad signal.
  const manual = {
    ...heldRow,
    manual_override: { mode: 'live', source: 'youtube', url: `https://www.youtube.com/watch?v=${VIDEO}`, video_id: VIDEO, title: 'Bible Study', set_at: iso(-10 * MIN), expires_at: iso(7 * 60 * MIN) },
  };
  const offline = loadService({ rows: [manual], reply: null, replyError: { message: 'network' } });
  const state = await offline.live.fetchLiveState(NOW);
  assert.equal(state.isLive, true);
  assert.equal(state.via, 'manual');
  assert.equal(state.title, 'Bible Study');
});

test('review: the panel never answers about the live stream with the last stream’s facts', () => {
  const { live } = loadService({ rows: [heldRow], reply: null });
  // A leader hand-started a DIFFERENT YouTube video. The row still remembers
  // the previous stream: its id, its title, and that YouTube refused to embed it.
  const row = {
    ...heldRow,
    video_id: 'NH5dJesdcAw',
    title: 'Prayer & Prophecy',
    embeddable: false,
    is_live: false,
    detail: 'offline: the last stream has ended',
    manual_override: { mode: 'live', source: 'youtube', url: `https://www.youtube.com/watch?v=${VIDEO}`, video_id: VIDEO, title: null, set_at: iso(-2 * MIN), expires_at: iso(7 * 60 * MIN) },
  };
  const state = logic.resolveLiveState(row, NOW);
  assert.equal(state.isLive, true);
  assert.equal(state.embeddable, null, 'we know nothing about embedding for a stream YouTube never reported');

  // Watch plays it inside the app (embeddable is not false)...
  assert.equal(live.watchActionFor(state).kind, 'in-app');
  // ...so the panel must not tell the leader it opens YouTube instead.
  assert.doesNotMatch(live.embeddableText(state), /will not let this one play/);
  assert.match(live.embeddableText(state), /Not known yet/);

  const facts = Object.fromEntries(live.liveFacts(state, NOW).map((f) => [f.label, f.value]));
  assert.equal(facts['Video id'], VIDEO, 'the id of the stream that is live, not the one before it');
  assert.doesNotMatch(facts['Stream title'], /Prayer & Prophecy/);
});

test('review: once nothing is live, the last stream’s facts are still shown — they are facts', () => {
  const { live } = loadService({ rows: [heldRow], reply: null });
  const row = { ...heldRow, is_live: false, embeddable: false, detail: 'offline: the last stream has ended', manual_override: null };
  const state = logic.resolveLiveState(row, NOW);
  assert.equal(state.isLive, false);
  assert.match(live.embeddableText(state), /will not let this one play/);
  const facts = Object.fromEntries(live.liveFacts(state, NOW).map((f) => [f.label, f.value]));
  assert.equal(facts['Video id'], VIDEO);
  assert.equal(facts['Stream title'], 'Sunday Service');
});

test('review: a Facebook live is never given the last YouTube stream’s video id', () => {
  const { live } = loadService({ rows: [heldRow], reply: null });
  const row = {
    ...heldRow,
    is_live: false,
    detail: 'offline: the last stream has ended',
    manual_override: { mode: 'live', source: 'facebook', url: 'https://www.facebook.com/ogn/videos/123/', video_id: null, title: 'Sunday Service', set_at: iso(-2 * MIN), expires_at: iso(7 * 60 * MIN) },
  };
  const state = logic.resolveLiveState(row, NOW);
  assert.equal(state.source, 'facebook');
  const facts = Object.fromEntries(live.liveFacts(state, NOW).map((f) => [f.label, f.value]));
  assert.doesNotMatch(facts['Video id'], /G5h7XID3Re8/);
  assert.match(facts['Video id'], /Facebook/);
  assert.match(live.embeddableText(state), /Facebook/);
});

test('review: a hand-started live with no title says so instead of borrowing the last one', () => {
  const { live } = loadService({ rows: [heldRow], reply: null });
  const row = {
    ...heldRow,
    video_id: 'NH5dJesdcAw',
    title: 'Prayer & Prophecy',
    is_live: false,
    detail: 'offline: the last stream has ended',
    manual_override: { mode: 'live', source: 'youtube', url: `https://www.youtube.com/watch?v=${VIDEO}`, video_id: VIDEO, title: null, set_at: iso(-2 * MIN), expires_at: iso(7 * 60 * MIN) },
  };
  const facts = Object.fromEntries(live.liveFacts(logic.resolveLiveState(row, NOW), NOW).map((f) => [f.label, f.value]));
  assert.match(facts['Stream title'], /Live service/, 'it names what the app really shows');
  assert.doesNotMatch(facts['Stream title'], /Prayer & Prophecy/);
});

test('review: Home keeps a door to the live screen for leaders when the check itself failed', () => {
  const banner = read('components/LiveBanner.tsx');
  // It is the only way to /live anywhere in the app.
  const doors = [read('app/live.tsx'), banner, read('app/(tabs)/index.tsx')].join('\n');
  assert.ok(banner.includes("pathname: '/live'"), 'the banner opens the live screen');
  assert.match(banner, /const \{ state, loading, error \} = useLiveStatus\(\)/);
  // Members still see nothing at all (DO-NOT-BREAK #2 and #14): the role is
  // asked before anything is drawn for a failed check.
  const failedAt = banner.indexOf('checkFailed');
  const roleAt = banner.indexOf('if (!canManageLive) return null;');
  assert.ok(roleAt >= 0 && failedAt > roleAt, 'the leaders-only gate comes first');
  assert.match(banner, /could not check/i);
  assert.ok(doors.length > 0);
});

test('review: End live only says the live card is down when it really is', () => {
  const screen = read('app/live.tsx');
  const stop = screen.slice(screen.indexOf('async function stopLive'), screen.indexOf('/** Undo an “End live”'));
  assert.match(stop, /const after = await onChanged\(\)/, 'the state after the reload decides the words');
  assert.match(stop, /after\?\.isLive/);
  assert.match(stop, /Live has ended in the app\./);
  // reloadNow hands the new state back rather than throwing it away.
  const service = read('lib/liveService.ts');
  assert.match(service, /const reloadNow = useCallback\(\(\) => run\(\), \[run\]\)/);
  assert.match(service, /Promise<LiveState \| null>/);
});
