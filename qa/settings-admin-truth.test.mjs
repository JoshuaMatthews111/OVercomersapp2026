// The adversarial pass over the settings area (More, app/settings/, Admin,
// lib/contentService.ts) on 2026-09-23.
//
// Every test here is a thing the screens were SAYING that was not true, or a
// place a tap led nowhere. The owner's TestFlight-36 complaint was exactly
// that class of defect ("Account settings button doesn't work", "About OGN
// still doesn't open another tab"), so a fix that leaves another one behind
// has not finished the job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function load(rel, stubs = {}) {
  const source = read(rel)
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}

const content = load('lib/contentService.ts', {
  supabase: {},
  hasSupabase: false,
  FriendlyError: class FriendlyError extends Error {},
  STORY_LIFETIME_MS: 86400000,
  youtubeThumbnailUrl: () => null,
});

// ---------------------------------------------------------------------------
// A story the content filter held must never be called live
// ---------------------------------------------------------------------------
// public.app_story_auto_review() is a BEFORE INSERT trigger: it can set the
// saved row's status to 'draft' and the row still comes back looking perfectly
// saved (DO-NOT-BREAK #18 — the filter lives in the database). Admin's story
// form threw that row away and said "It is on Home right now and stays there
// for 24 hours", with a "View post" button straight to Home, where the held
// story is not. lib/contentService.ts already exported storyWentOut() for this
// and app/(tabs)/index.tsx already used it; Admin did not.

test('every story went out: the old wording, kept exactly', () => {
  const one = content.storyPostConfirmation(1, 1);
  assert.equal(one.title, 'Story posted');
  assert.equal(one.statusLabel, 'Published');
  assert.equal(one.body, 'It is on Home right now and stays there for 24 hours.');
  assert.equal(one.canOpenHome, true);

  const many = content.storyPostConfirmation(3, 3);
  assert.equal(many.title, '3 stories posted');
  assert.match(many.body, /They are on Home right now/);
  assert.equal(many.canOpenHome, true);
});

test('a held story is called a draft, and offers no button to an empty Home', () => {
  const one = content.storyPostConfirmation(1, 0);
  assert.equal(one.statusLabel, 'Draft', 'a held story is not Published');
  assert.match(one.body, /waiting for a leader to read it/);
  assert.doesNotMatch(one.body, /on Home right now/, 'it is not on Home — do not say it is');
  assert.equal(one.canOpenHome, false, 'no "View post" to a ring it is not in');
  assert.match(one.whereHint, /Needs your look/, 'say where it actually is instead');

  const many = content.storyPostConfirmation(2, 0);
  assert.equal(many.statusLabel, 'Draft');
  assert.match(many.body, /waiting for a leader to read them/);
  assert.equal(many.canOpenHome, false);
});

test('some out, some held: the count is the real one and Home still opens', () => {
  const mixed = content.storyPostConfirmation(4, 1);
  assert.equal(mixed.statusLabel, 'Draft');
  assert.match(mixed.body, /1 of 4 are on Home now/);
  assert.match(mixed.body, /nothing has been lost/);
  assert.equal(mixed.canOpenHome, true, 'one of them IS on Home, so the button is honest');
});

test('a count that cannot happen still reads sensibly', () => {
  // live can never exceed total, but a confirmation must not produce
  // "-1 of 1" if it ever did.
  const odd = content.storyPostConfirmation(1, 5);
  assert.equal(odd.statusLabel, 'Published');
  assert.equal(odd.canOpenHome, true);
});

test('Admin asks the saved row, instead of assuming it published', () => {
  const admin = read('app/admin.tsx');
  assert.match(admin, /if \(storyWentOut\(saved\)\) wentOut \+= 1;/, 'the saved row decides');
  assert.match(admin, /const said = storyPostConfirmation\(posted, live\);/);
  assert.doesNotMatch(
    admin,
    /body="It is on Home right now and stays there for 24 hours\."/,
    'the unconditional "it is on Home" line must be gone',
  );
  assert.doesNotMatch(admin, /statusLabel="Published"/, 'no story may be called Published without the row saying so');
});

// ---------------------------------------------------------------------------
// Send a notice: shown to people the database refuses
// ---------------------------------------------------------------------------
// public.announcements takes an INSERT only from admin, super_admin, leader,
// moderator and staff. canOpenAdmin is wider than that — it also admits
// outreach, outreach_worker and media_admin — and "Send a notice" was the one
// Admin row with no condition on it at all. Those accounts could open it,
// write a church-wide notice, answer "Send to Everyone?", and only then be
// refused by row security.

test('Send a notice is offered to exactly the roles the database allows', () => {
  const admin = read('app/admin.tsx');
  assert.match(
    admin,
    /\{access\.canManageContent \|\| access\.canModerateChat \? \(\s*\n\s*<Row icon="megaphone-outline"/,
    'the notice row must be gated the way announcements INSERT is',
  );
  // canManageContent = staff/leader/admin/super_admin,
  // canModerateChat  = moderator/staff/leader/admin/super_admin.
  // Together: exactly the policy's five roles.
  const access = read('lib/accessControl.ts');
  assert.match(access, /STAFF_OR_ABOVE_ROLES: RawAppRole\[\] = \['staff', 'leader', 'admin', 'super_admin'\]/);
  assert.match(access, /CHAT_MODERATOR_ROLES: RawAppRole\[\] = \['moderator', 'staff', 'leader', 'admin', 'super_admin'\]/);
});

test('an account with no Admin powers is told so, not shown a blank screen', () => {
  const admin = read('app/admin.tsx');
  assert.match(admin, /\{!anyAdminRow \?/, 'all five rows are conditional — something must be left on screen');
  assert.match(admin, /title="Nothing here for your account yet"/);
});

test('a deep link cannot open an Admin page the account may not have', () => {
  const admin = read('app/admin.tsx');
  // /admin?page=people used to walk a moderator straight into the People list.
  assert.match(admin, /const pageAllowed: Record<Page, boolean> = \{/);
  assert.match(admin, /people: access\.canOverrideLeaderData,/);
  assert.match(admin, /notice: access\.canManageContent \|\| access\.canModerateChat,/);
  // The address supplies `requestedPage`; `page` — the only one the JSX reads —
  // is the settled answer. The rename is deliberate: every existing
  // `{page === '...'}` line keeps its text, so nothing else that reads this
  // file had to change.
  assert.match(admin, /const \[requestedPage, setRequestedPage\] = useState<Page>\(/);
  assert.match(admin, /const page: Page = pageAllowed\[requestedPage\] \? requestedPage : 'home';/);
  assert.doesNotMatch(
    admin,
    /const \[page, setPage\] = useState<Page>/,
    'the address must not be drawn straight onto the screen',
  );
});

test('a notice that did not send never claims it was saved', () => {
  const admin = read('app/admin.tsx');
  // sendAdminPush stores first and pushes second, so a throw has two quite
  // different meanings and the old sentence picked the wrong one out loud.
  assert.doesNotMatch(admin, /It is saved in Announcements either way/);
  assert.match(admin, /If it is not there, nothing went out\./);
});

// ---------------------------------------------------------------------------
// Where a posted thing really lives
// ---------------------------------------------------------------------------

test('a devotional is sent to the Sermons list it is actually in', () => {
  // app/(tabs)/messages.tsx lists devotionals with byKind(['sermon',
  // 'devotional']) — they are never in the blog list.
  const messages = read('app/(tabs)/messages.tsx');
  assert.match(messages, /byKind\(\['sermon', 'devotional'\]\)/);
  assert.match(messages, /byKind\(\['article'\]\)/);

  const posted = { what: 'media', mediaType: 'devotional', title: 'Morning', status: 'published', url: null };
  assert.match(content.whereItLives(posted), /Sermons section/);
  const open = content.viewPostAction(posted, { embedFor: () => null, kindFor: () => null });
  assert.equal(open.href, '/(tabs)/messages', 'never the blog tab');

  // A real article still opens the blog list.
  const article = content.viewPostAction(
    { what: 'media', mediaType: 'article', title: 'Grace', status: 'published', url: '' },
    { embedFor: () => null, kindFor: () => null },
  );
  assert.equal(article.href, '/(tabs)/messages?tab=blog');
});

// ---------------------------------------------------------------------------
// Typing, on a phone with a keyboard in the way
// ---------------------------------------------------------------------------
// The More tab's own ScrollView always carried automaticallyAdjustKeyboardInsets
// ("iOS: make room for the keyboard so the field being typed into is never
// underneath it"). The deletion flow lost it when it moved to its own page —
// and Apple 5.1.1(v) needs that box reachable.

test('every settings page with a box to type in makes room for the keyboard', () => {
  for (const file of ['app/settings/delete-account.tsx', 'app/settings/account.tsx', 'app/admin.tsx']) {
    const source = read(file);
    assert.match(source, /automaticallyAdjustKeyboardInsets/, `${file} must lift its content above the keyboard`);
    assert.match(source, /keyboardShouldPersistTaps="handled"/, `${file}: a button under the keyboard must take the first tap`);
  }
  // account.tsx drives its own scroll view for this, the way delete-account
  // already did, and still takes its safe areas and colours from <Screen>.
  const account = read('app/settings/account.tsx');
  assert.match(account, /<Screen scroll=\{false\}>/);
  assert.match(account, /from '\.\.\/\.\.\/components\/Screen'/);
});

// ---------------------------------------------------------------------------
// A chevron is a promise
// ---------------------------------------------------------------------------

test('no More row draws a chevron-forward without pushing a page', () => {
  const profile = read('app/(tabs)/profile.tsx');
  // The walkthrough opens over the tabs you are already on — it is not a page.
  const line = profile.split('\n').find((l) => l.includes("label: 'Show me around again'"));
  assert.ok(line, 'the walkthrough row is missing');
  assert.match(line, /kind: 'inline' as const/, 'it changes something you can see here, so no chevron');
  assert.match(line, /resetWelcomeTour\(tourUserId\)/);

  // And every row that is left on the default kind really does push.
  const rows = profile
    .split('\n')
    .filter((l) => /^\s*(\.\.\.\(|\{)?\s*(\[)?\{ label: '/.test(l));
  assert.ok(rows.length >= 10, `expected the settings rows, found ${rows.length}`);
  for (const row of rows) {
    const declares = /kind: '(expand|inline|away)'/.test(row);
    if (declares) continue;
    assert.match(
      row,
      /router\.push\(/,
      `a row with no kind promises a page, so it must push one: ${row.trim()}`,
    );
  }
});
