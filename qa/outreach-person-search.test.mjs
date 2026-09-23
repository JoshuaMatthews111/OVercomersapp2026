// Finding a person by typing (TestFlight 36): the waiting, the throwing away
// and what the screen says while it happens.
//
// The owner's words: "searching while typing home cells — the name drops down
// when adding a home cell leader; we should really have to hit the search
// button? a list should show with their profile pic as we type their name."
//
// Pure logic, with a fake clock, so the 250 ms wait is tested in no time at
// all. The ADDRESS search is tested NOT to have changed: Nominatim allows one
// request a second and keeps its Find button.
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

const p = load('lib/peopleSearch.ts');

/** A clock the test drives by hand, so nothing waits in real time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => { const id = nextId++; pending.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (id) => { pending.delete(id); },
    },
    /** Move time on and run whatever was due. */
    tick(ms) {
      now += ms;
      for (const [id, entry] of [...pending.entries()]) {
        if (entry.at <= now) { pending.delete(id); entry.fn(); }
      }
    },
    get waiting() { return pending.size; },
  };
}

/** A lookup whose answers the test resolves by hand. */
function controllableSearch() {
  const calls = [];
  const search = (term, signal) => new Promise((resolve, reject) => {
    calls.push({ term, signal, resolve, reject });
  });
  return { search, calls };
}

const person = (id, displayName, hint) => ({ id, displayName, hint });

function build(options = {}) {
  const clock = fakeClock();
  const lookup = controllableSearch();
  const states = [];
  const controller = p.createPersonSearch({
    search: options.search || lookup.search,
    onState: (state) => states.push(state),
    timers: clock.timers,
    makeAbort: () => new AbortController(),
    describeError: (error) => (error && error.message) || 'Those names could not load just now.',
    ...options.settings,
  });
  return { clock, lookup, states, controller, last: () => states[states.length - 1] };
}

test('typing a name asks once, not once per keystroke', async () => {
  const { clock, lookup, controller } = build();
  for (const text of ['J', 'Jo', 'Jos', 'Josh']) controller.type(text);
  assert.equal(lookup.calls.length, 0, 'nothing is asked while the finger is still moving');
  clock.tick(249);
  assert.equal(lookup.calls.length, 0);
  clock.tick(1);
  assert.equal(lookup.calls.length, 1, 'four keystrokes, one request');
  assert.equal(lookup.calls[0].term, 'Josh');
});

test('one letter asks nothing and says so', () => {
  const { clock, lookup, controller, last } = build();
  controller.type('J');
  clock.tick(1000);
  assert.equal(lookup.calls.length, 0);
  assert.equal(last().status, 'too-short');
  assert.equal(p.personSearchNote(last()), 'Keep typing — 2 letters or more.');
  // And an empty box is simply idle, with nothing to read.
  controller.type('');
  assert.equal(last().status, 'idle');
  assert.equal(p.personSearchNote(last()), null);
});

test('deleting back to one letter clears the list — it never sits under a name that does not match', async () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Josh');
  clock.tick(250);
  lookup.calls[0].resolve([person('u1', 'Joshua Matthews')]);
  await Promise.resolve();
  assert.equal(last().results.length, 1);

  controller.type('J');
  assert.deepEqual(last().results, [], 'the list goes when the name it belongs to goes');
  assert.equal(last().status, 'too-short');
});

test('a slow answer for an old name can never overwrite the new one', async () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Jo');
  clock.tick(250);
  controller.type('Joshua');
  clock.tick(250);
  assert.equal(lookup.calls.length, 2);

  // The second answer lands first, then the stale first answer arrives.
  lookup.calls[1].resolve([person('u1', 'Joshua Matthews')]);
  await Promise.resolve(); await Promise.resolve();
  lookup.calls[0].resolve([person('u2', 'Jody Adams'), person('u3', 'John Bell')]);
  await Promise.resolve(); await Promise.resolve();

  assert.deepEqual(last().results.map((r) => r.displayName), ['Joshua Matthews'],
    'the answer to the question nobody is asking any more is thrown away');
  assert.equal(last().status, 'done');
});

test('the request itself is aborted, not just ignored', () => {
  const { clock, lookup, controller } = build();
  controller.type('Jo');
  clock.tick(250);
  const first = lookup.calls[0];
  assert.equal(first.signal.aborted, false);
  controller.type('Joshua');
  clock.tick(250);
  assert.equal(first.signal.aborted, true, 'the old request is stopped, not left running');
});

test('a stale failure cannot put an error under a name that is already answered', async () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Jo');
  clock.tick(250);
  controller.type('Joshua');
  clock.tick(250);
  lookup.calls[1].resolve([person('u1', 'Joshua Matthews')]);
  await Promise.resolve(); await Promise.resolve();
  lookup.calls[0].reject(new Error('the connection dropped'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(last().status, 'done');
  assert.equal(last().results.length, 1);
});

test('a failure is shown, and Try again asks the same name straight away', async () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Joshua');
  clock.tick(250);
  lookup.calls[0].reject(new Error('Those names could not load just now.'));
  await Promise.resolve(); await Promise.resolve();

  assert.equal(last().status, 'failed');
  assert.deepEqual(last().results, []);
  assert.equal(p.personSearchNote(last()), 'Those names could not load just now.');

  controller.retry();
  assert.equal(lookup.calls.length, 2, 'Try again does not wait another quarter second');
  assert.equal(lookup.calls[1].term, 'Joshua');
  assert.equal(last().status, 'searching');
});

test('nobody found says so, in the words of the list being searched', async () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Zeke');
  clock.tick(250);
  lookup.calls[0].resolve([]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.personSearchNote(last()), 'Nobody by that name.');
  assert.equal(p.personSearchNote(last(), { noun: 'Nobody on the outreach team' }), 'Nobody on the outreach team by that name.');
  // A list that DID find people needs no sentence at all — it is the answer.
  lookup.calls.length = 0;
  controller.type('Ana');
  clock.tick(250);
  lookup.calls[0].resolve([person('u1', 'Ana Silva')]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.personSearchNote(last()), null);
});

test('leaving the screen stops the timer and drops the answer', async () => {
  const { clock, lookup, controller, states } = build();
  controller.type('Joshua');
  const before = states.length;
  controller.dispose();
  clock.tick(1000);
  assert.equal(lookup.calls.length, 0, 'a search that had not started never starts');
  assert.equal(states.length, before, 'and nothing tries to redraw a screen that has gone');
});

test('an answer that lands DURING the 250 ms wait cannot paint itself under the new name', async () => {
  // Review find, 2026-09-23. type() used to leave the previous request running
  // and only abort it when the next one started, 250 ms later. In that window
  // the old answer came back, nothing had bumped the generation, and it
  // published itself as "done" under the name now in the box: the list read as
  // finished while showing people who do not match a single letter of it.
  const { clock, lookup, controller, last } = build();
  controller.type('Jo');
  clock.tick(250);
  assert.equal(lookup.calls.length, 1);

  controller.type('Josh');              // still inside the wait — nothing asked yet
  assert.equal(lookup.calls.length, 1);
  assert.equal(lookup.calls[0].signal.aborted, true, 'the old request is stopped at the keystroke, not 250 ms later');

  lookup.calls[0].resolve([person('u2', 'Jody Adams')]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(last().term, 'Josh');
  assert.equal(last().status, 'searching', 'the screen is still waiting, not showing somebody else');
  assert.equal(last().results.length, 0);

  clock.tick(250);
  lookup.calls[1].resolve([person('u1', 'Joshua Matthews')]);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(last().results.map((r) => r.displayName), ['Joshua Matthews']);
  assert.equal(last().status, 'done');
});

test('clearing the box empties it without asking anything', () => {
  const { clock, lookup, controller, last } = build();
  controller.type('Joshua');
  controller.clear();
  clock.tick(1000);
  assert.equal(lookup.calls.length, 0);
  assert.equal(last().term, '');
  assert.equal(last().status, 'idle');
});

// ── the screens ─────────────────────────────────────────────────────────────

test('every place a PERSON is picked now finds them by typing', () => {
  for (const file of ['app/home-cells.tsx', 'app/follow-ups.tsx', 'app/maps.native.tsx', 'app/maps.tsx']) {
    assert.match(read(file), /OutreachPersonSearch/, `${file} should find people as you type`);
  }
  // And none of them still has a Search button for a person.
  assert.doesNotMatch(read('app/follow-ups.tsx'), /accessibilityLabel="Search"/);
  assert.doesNotMatch(read('app/maps.native.tsx'), /Search the outreach team"/);
  assert.doesNotMatch(read('app/home-cells.tsx'), /accessibilityLabel="Search people"/);
});

test('the list shows a face and something to tell two people apart', () => {
  const component = read('components/OutreachPersonSearch.tsx');
  // The owner asked for the profile picture.
  assert.match(component, /person\.avatarUrl/);
  assert.match(component, /initialsFor\(person\.displayName\)/, 'and initials when there is no photo');
  assert.match(component, /person\.hint/);
  // The hint is real: a role for the outreach team, a region for anyone else.
  const service = read('lib/evangelismService.ts');
  assert.match(service, /hint: roleLabel\(roleByUser\.get\(row\.id\)\)/);
  assert.match(service, /Leads \$\{name\}/);
  assert.match(service, /On the \$\{name\} team/);
});

test('the ADDRESS search is untouched: still one request a second, still a Find button', () => {
  const cells = read('lib/homeCells.ts');
  // The queue and the identifying headers Nominatim asks for are still there.
  assert.match(cells, /waitForNominatimTurn/);
  assert.match(cells, /nominatimHeaders/);
  const screen = read('app/home-cells.tsx');
  assert.match(screen, /accessibilityLabel="Find this address on the map"/);
  assert.match(screen, /onSubmitEditing=\{findFromText\}/);
  // findPlace is never wired to onChangeText, which is what would break the
  // one-a-second promise.
  assert.doesNotMatch(screen, /onChangeText=\{[^}]*findPlace/);
  // And the screen says why, so the Find button does not look broken beside
  // the name boxes that fill in as you type.
  assert.match(screen, /Addresses need the Find button/);
});
