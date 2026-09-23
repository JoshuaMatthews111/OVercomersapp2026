// The More tab's rows open real pages (owner, TestFlight 36: "About OGN still
// doesn't open another tab", "Account settings button doesn't work").
//
// The old panel was rendered BELOW the whole fifteen-row settings list, so a
// tap looked dead. These tests lock in the fix: every chevron row pushes a
// screen, the new screens are registered inside <Stack.Protected>
// (DO-NOT-BREAK #3 and #33), and the account-deletion flow moved WORD FOR WORD
// rather than being rewritten (Apple 5.1.1(v) — it works today).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const exists = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));

const SETTINGS_SCREENS = ['account', 'about', 'saved', 'downloads', 'delete-account'];

test('every More row that promises a page opens one', () => {
  const profile = read('app/(tabs)/profile.tsx');
  const rows = [
    ["Account Settings", '/settings/account'],
    ['Saved Media', '/settings/saved'],
    ['Downloads', '/settings/downloads'],
    ['About Overcomers Global Network', '/settings/about'],
    ['Delete My Account', '/settings/delete-account'],
  ];
  for (const [label, href] of rows) {
    const line = profile.split('\n').find((l) => l.includes(`label: '${label}'`));
    assert.ok(line, `no More row labelled ${label}`);
    assert.ok(line.includes(`router.push('${href}'`), `${label} must push ${href}, got: ${line.trim()}`);
  }
});

test('the dead panel is gone from the More tab', () => {
  const profile = read('app/(tabs)/profile.tsx');
  assert.doesNotMatch(profile, /SettingsDetailPanel/, 'the panel that rendered below the list must be gone');
  assert.doesNotMatch(profile, /settingsDetail/, 'no settings-detail state left behind');
  assert.doesNotMatch(profile, /openSettingsDetail/);
  // Notifications and Theme are switches, not pages: they stay inline.
  // The rows are objects that may span several lines, so match across them.
  assert.match(profile, /label: 'Notifications'[\s\S]{0,400}?setShowNotificationSettings/);
  assert.match(profile, /label: 'Theme'[\s\S]{0,400}?setThemeMode/);
});

test('each new screen exists, has a back button and is registered inside Stack.Protected', () => {
  const layout = read('app/_layout.tsx');
  const protectedBlock = layout.split('<Stack.Protected')[1] || '';
  assert.ok(protectedBlock.includes('<Stack.Screen name="settings" />'), 'settings must sit inside Stack.Protected');
  assert.ok(exists('app/settings/_layout.tsx'), 'the settings stack needs its own layout');

  const stack = read('app/settings/_layout.tsx');
  for (const name of SETTINGS_SCREENS) {
    assert.ok(exists(`app/settings/${name}.tsx`), `app/settings/${name}.tsx is missing`);
    assert.ok(stack.includes(`name="${name}"`), `${name} is not listed in the settings stack`);
    const screen = read(`app/settings/${name}.tsx`);
    assert.match(screen, /accessibilityLabel="Back to More"/, `${name} needs a back button to More`);
    // The safe-area + both-themes wrapper every pushed screen uses.
    assert.match(screen, /from '\.\.\/\.\.\/components\/Screen'/, `${name} must use <Screen> for safe areas`);
    assert.match(screen, /useAppTheme\(\)/, `${name} must read the chosen theme`);
    assert.doesNotMatch(screen, /#[0-9a-fA-F]{6}/, `${name} must use theme tokens, not colour literals`);
  }
});

test('Account Settings keeps the save behaviour that already shipped', () => {
  const account = read('app/settings/account.tsx');
  assert.match(account, /displayName\.trim\(\) \|\| session\.user\.user_metadata\?\.display_name \|\| access\.displayName \|\| session\.user\.email \|\| 'OGN Member'/);
  assert.match(account, /supabase\.from\('profiles'\)\.upsert\(/);
  assert.match(account, /supabase\.auth\.updateUser\(\{ data: \{ display_name: nextName \} \}\)/);
  assert.match(account, /Alert\.alert\('Saved', 'Your profile is up to date\.'\)/);
  // The avatar is read before the upsert, so saving a name cannot wipe a photo.
  assert.match(account, /select\('avatar_url, display_name'\)/);
  assert.match(account, /avatar_url: avatarUrl/);
});

test('deleting an account moved verbatim — every message, the countdown and the edge function', () => {
  const page = read('app/settings/delete-account.tsx');
  assert.match(page, /const DELETE_PHRASE = 'DELETE';/);
  for (const stage of ['Checking your sign-in', 'Removing your account and everything saved with it', 'Signing this phone out']) {
    assert.ok(page.includes(stage), `the ticked stage "${stage}" must still be there`);
  }
  assert.match(page, /supabase\.functions\.invoke\('delete-account', \{/, 'deletion still happens in the app');
  assert.match(page, /Write DELETE to confirm/);
  assert.match(page, /Almost there/);
  assert.match(page, /Delete your account\?/);
  assert.match(page, /Keep my account/);
  assert.match(page, /Your account is gone/);
  assert.match(page, /so far\. Please keep the app open\./);
  assert.match(page, /Everything you had saved has been removed, but your sign-in is still here/);
  assert.match(page, /We lost the connection before we heard back/);
  assert.match(page, /router\.replace\('\/welcome'\)/);
  // No hand-off to email anywhere on the deletion path (Play User Data policy).
  assert.doesNotMatch(page, /mailto:/);
  // And it is gone from the tab it used to live on.
  const profile = read('app/(tabs)/profile.tsx');
  assert.doesNotMatch(profile, /functions\.invoke\('delete-account'/, 'the invoke must not be left behind on the More tab');
  assert.doesNotMatch(profile, /DELETE_PHRASE/, 'the typed confirmation lives on its own page now');
  assert.match(profile, /router\.push\('\/settings\/delete-account'/, 'the More row still leads there');
});

test('About OGN carries the ministry words plus vision, mission and contact', () => {
  const about = read('app/settings/about.tsx');
  assert.ok(about.includes('Overcomers Global Network exists to educate, equip, and evolve believers into victorious relationship with Christ while impacting lives and nations through the Gospel. One Vision. Every Nation. Eternal Impact.'));
  assert.match(about, /Our vision/);
  assert.match(about, /Our mission/);
  assert.match(about, /support@overcomersglobalnetwork\.com/);
  assert.match(about, /overcomersglobalnetwork\.com/);
});

test('Saved Media and Downloads keep their original words and destinations', () => {
  assert.ok(read('app/settings/saved.tsx').includes('Sermons, articles, videos and music you save are kept in the Media library.'));
  assert.match(read('app/settings/saved.tsx'), /router\.push\('\/\(tabs\)\/messages'/);
  assert.ok(read('app/settings/downloads.tsx').includes('Anything the ministry marks as downloadable is kept on the Media tab, ready to play without a signal.'));
  assert.match(read('app/settings/downloads.tsx'), /params: \{ tab: 'downloads' \}/);
});

test('Admin still has exactly five rows (DO-NOT-BREAK #21)', () => {
  const admin = read('app/admin.tsx');
  const rows = admin.match(/<Row\b/g) || [];
  assert.equal(rows.length, 5, `Admin must stay five rows, found ${rows.length}`);
});
