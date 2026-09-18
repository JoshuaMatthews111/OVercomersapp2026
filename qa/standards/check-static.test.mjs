/**
 * The gate, pinned.
 *
 * A release gate is only worth having if it is itself checked, because the two
 * ways it can fail are opposites and both are quiet. It can cry wolf, and then
 * people switch it off. Or it can wave something through, and then people trust
 * it — which is worse, because the owner has already been handed a green report
 * that was green because the hard half was skipped.
 *
 * So every detector here is asked twice: once against a snippet that really is
 * broken, and once against a snippet that really is fine. A detector that only
 * ever gets shown broken code is a regex nobody has tested.
 *
 * Two of these tests matter more than the rest:
 *
 *   "the secret detector never prints the secret" plants a real-looking key and
 *   asserts that not one character of it reaches the human report or the JSON.
 *   A report gets pasted into chats. It must be safe to paste.
 *
 *   "only a blocker changes the exit code" is the promise that makes the gate
 *   usable at all. Ninety medium findings must not stop a release; one blocker
 *   must.
 *
 *   node --test qa/standards/check-static.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  runGate, parseArgs, main, renderReport, buildBaselineFile, applyBaseline, loadBaseline,
  maskSource, styleEntries, parseStyleSheets, parseJsx, contrastRatio, parseColor, imageSize,
} from './check-static.mjs';
import { RULES, RULES_BY_ID, rulesFor } from './rules.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// A throwaway app on disk, so the gate is exercised the way it really runs.
// ─────────────────────────────────────────────────────────────────────────────

const APP_JSON = {
  expo: {
    name: 'Overcomers Global Network',
    slug: 'overcomers-global-network-app',
    scheme: 'ognapp',
    version: '1.0.1',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'com.overcomers.globalnetwork.app',
      infoPlist: {
        NSCameraUsageDescription: 'OGN lets you take photos for your profile, ministry stories, and ministry uploads.',
      },
    },
    android: {
      package: 'com.overcomers.globalnetwork.app',
      permissions: [],
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: { foregroundImage: './assets/adaptive.png' },
    },
    plugins: [
      ['expo-splash-screen', { image: './assets/splash.png' }],
      ['expo-build-properties', { android: { targetSdkVersion: 35 } }],
    ],
    extra: { eas: { projectId: '8e9b3da8-b8dc-4275-a247-e226a4eca99a' } },
  },
};

/** A tiny but genuinely valid PNG header, so the picture-size reader has something real to read. */
function pngBytes(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

let made = [];

function fixture(files = {}, appJson = APP_JSON) {
  const dir = mkdtempSync(join(tmpdir(), 'ogn-gate-'));
  made.push(dir);
  const write = (rel, body) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'string' ? body : body);
  };
  write('app.json', JSON.stringify(appJson, null, 2));
  write('package.json', JSON.stringify({ name: 'ogn', version: '1.0.1', dependencies: { 'expo-navigation-bar': '~5.0.0' } }, null, 2));
  write('store.config.json', JSON.stringify({ apple: { version: '1.0.1' } }, null, 2));
  write('eas.json', JSON.stringify({ cli: { appVersionSource: 'remote' } }, null, 2));
  write('lib/theme.ts', "export const colors = { gold: '#D4AF37', white: '#FFFFFF', deepBlue: '#071B45', brightBlue: '#123A8F', textBody: '#111827' };\n");
  // A camera call site, so the base fixture's own permission string is honest,
  // and one import of the theme so nothing in it reads as unreachable.
  write('lib/capture.ts', "import * as ImagePicker from 'expo-image-picker';\nimport { colors } from './theme';\nexport const tint = colors.gold;\nexport const shoot = () => ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });\n");
  write('assets/icon.png', pngBytes(1024, 1024));
  write('assets/adaptive.png', pngBytes(512, 512));
  write('assets/splash.png', pngBytes(1024, 1024));
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return dir;
}

test.after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** Run the gate over a throwaway app and hand back a way to ask about one rule. */
function gate(files, { platform = 'both', baseline = null, colorMax = 6, appJson = APP_JSON } = {}) {
  const root = fixture(files, appJson);
  const report = runGate({ platform, json: false, baseline, writeBaseline: null, root, colorMax, quiet: false });
  return {
    root,
    report,
    rule: (id) => report.rules.find((r) => r.id === id),
    fires: (id) => {
      const r = report.rules.find((x) => x.id === id);
      assert.ok(r, `${id} is not in the rule set at all`);
      return r.status === 'fail';
    },
    findings: (id) => (report.rules.find((x) => x.id === id)?.findings ?? []),
  };
}

const SCREEN_HEAD = `import React from 'react';
import { View, Text, Pressable, Image, TextInput, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemePreference } from '../lib/themePreference';
`;

// ─────────────────────────────────────────────────────────────────────────────
// The rule set itself
// ─────────────────────────────────────────────────────────────────────────────

test('every rule carries what the report needs to print it', () => {
  for (const r of RULES) {
    assert.match(r.id, /^[A-Z0-9-]+$/, `${r.id} has an id a person cannot quote`);
    assert.ok(['ios', 'android', 'both'].includes(r.platform), `${r.id} platform`);
    assert.ok(['blocker', 'high', 'medium', 'low'].includes(r.severity), `${r.id} severity`);
    assert.ok(['static', 'device'].includes(r.kind), `${r.id} kind`);
    assert.ok(r.title && r.title.length > 10, `${r.id} needs a title a person can read`);
    assert.ok(r.why && r.why.length > 20, `${r.id} needs to say why it matters`);
    assert.ok(RULES_BY_ID[r.id], `${r.id} is missing from the lookup`);
  }
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length, 'two rules share an id');
});

test('asking for one platform drops the other platform’s own rules', () => {
  const ios = rulesFor('ios');
  const android = rulesFor('android');
  assert.ok(ios.every((r) => r.platform !== 'android'));
  assert.ok(android.every((r) => r.platform !== 'ios'));
  assert.ok(ios.length < RULES.length && android.length < RULES.length);
  assert.equal(rulesFor('both').length, RULES.length);
});

// ─────────────────────────────────────────────────────────────────────────────
// The reading machinery
// ─────────────────────────────────────────────────────────────────────────────

test('words inside a sentence are never mistaken for code', () => {
  const src = `const note = 'catch { this is prose }'; // catch { so is this }\ntry { go(); } catch { }`;
  const { masked } = maskSource(src);
  assert.equal(masked.length, src.length, 'masking must not move anything');
  assert.equal((masked.match(/catch/g) ?? []).length, 1, 'only the real catch survives');
});

test('a dark-theme override is never merged into the light style it replaces', () => {
  const parts = styleEntries("[styles.title, dark && styles.titleDark, active && styles.titleActive]");
  assert.equal(parts.length, 3);
  assert.equal(parts.filter((p) => !p.conditional).length, 1);
  assert.equal(parts[0].text, 'styles.title');
});

test('the style sheet and the element tree come back usable', () => {
  const src = `${SCREEN_HEAD}
export default function S() {
  return (<View style={styles.wrap}><Text style={styles.t}>Hi</Text></View>);
}
const styles = StyleSheet.create({ wrap: { height: 40, backgroundColor: '#FFFFFF' }, t: { fontSize: 11 } });
`;
  const { masked } = maskSource(src);
  const styles = parseStyleSheets(src, masked);
  assert.equal(styles.wrap.props.height, '40');
  assert.equal(styles.t.props.fontSize, '11');
  const els = parseJsx(src, masked, () => 1);
  const view = els.find((e) => e.name === 'View');
  assert.ok(view);
  assert.equal(view.children.length, 1);
  assert.equal(view.children[0].name, 'Text');
});

test('contrast is worked out the way the accessibility standard does', () => {
  assert.equal(Math.round(contrastRatio(parseColor('#FFFFFF'), parseColor('#000000'))), 21);
  assert.equal(Math.round(contrastRatio(parseColor('#FFFFFF'), parseColor('#FFFFFF'))), 1);
  assert.ok(contrastRatio(parseColor('#123A8F'), parseColor('#071B45')) < 2, 'the auth link really is that faint');
});

test('a picture’s real size is read without decoding it', () => {
  const dir = fixture({});
  assert.deepEqual(imageSize(join(dir, 'assets/adaptive.png')), { width: 512, height: 512 });
  assert.equal(imageSize(join(dir, 'assets/missing.png')), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Each detector, shown broken code and then shown good code
// ─────────────────────────────────────────────────────────────────────────────

test('a button that is only an icon, with nothing to announce', () => {
  const bad = gate({
    'app/bad.tsx': `${SCREEN_HEAD}
export default function S() {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="button" style={styles.btn} onPress={() => {}}><Ionicons name="close" size={24} /></Pressable></View>);
}
const styles = StyleSheet.create({ btn: { width: 48, height: 48 } });
`,
  });
  assert.equal(bad.fires('A11Y-1'), true);

  const good = gate({
    'app/good.tsx': `${SCREEN_HEAD}
export default function S() {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.btn} onPress={() => {}}><Ionicons name="close" size={24} /></Pressable></View>);
}
const styles = StyleSheet.create({ btn: { width: 48, height: 48 } });
`,
  });
  assert.equal(good.fires('A11Y-1'), false);
});

test('a tap target too small for a fingertip, on each phone’s own measure', () => {
  const small = `${SCREEN_HEAD}
export default function S() {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.btn} onPress={() => {}}><Ionicons name="close" size={20} /></Pressable></View>);
}
const styles = StyleSheet.create({ btn: { width: 46, height: 46 } });
`;
  const g = gate({ 'app/small.tsx': small });
  assert.equal(g.fires('OGN-IOS-004'), false, '46 is fine for Apple');
  assert.equal(g.fires('AND-TOUCH-01'), true, '46 is not fine for Google');

  const big = gate({ 'app/big.tsx': small.replace('width: 46, height: 46', 'width: 48, height: 48') });
  assert.equal(big.fires('OGN-IOS-004'), false);
  assert.equal(big.fires('AND-TOUCH-01'), false);

  const slop = gate({ 'app/slop.tsx': small.replace('style={styles.btn}', 'hitSlop={8} style={styles.btn}') });
  assert.equal(slop.fires('AND-TOUCH-01'), false, 'hitSlop makes up the difference');
});

test('a picture with nothing to say for it, and one properly marked decorative', () => {
  const bad = gate({
    'components/Bad.tsx': `import React from 'react';
import { Image, View } from 'react-native';
export function Bad({ dark }: { dark: boolean }) { return (<View><Image source={{ uri: 'x' }} /></View>); }
`,
  });
  assert.equal(bad.fires('A11Y-2'), true);

  const good = gate({
    'components/Good.tsx': `import React from 'react';
import { Image, View } from 'react-native';
export function Good({ dark }: { dark: boolean }) {
  return (<View><Image source={{ uri: 'x' }} accessibilityLabel="The congregation in Zambia" /><Image source={{ uri: 'y' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /></View>);
}
`,
  });
  assert.equal(good.fires('A11Y-2'), false);
});

test('a tab that looks chosen but never says it is chosen', () => {
  const bad = gate({
    'app/tabs.tsx': `${SCREEN_HEAD}
export default function S({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="tab" accessibilityLabel="KJV" onPress={() => {}} style={[styles.chip, active && styles.chipActive]}><Text>KJV</Text></Pressable></View>);
}
const styles = StyleSheet.create({ chip: { minHeight: 48, minWidth: 48 }, chipActive: { backgroundColor: '#D4AF37' } });
`,
  });
  assert.equal(bad.fires('A11Y-3'), true);

  const good = gate({
    'app/tabs2.tsx': `${SCREEN_HEAD}
export default function S({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="tab" accessibilityLabel="KJV" accessibilityState={{ selected: active }} onPress={() => {}} style={[styles.chip, active && styles.chipActive]}><Text>KJV</Text></Pressable></View>);
}
const styles = StyleSheet.create({ chip: { minHeight: 48, minWidth: 48 }, chipActive: { backgroundColor: '#D4AF37' } });
`,
  });
  assert.equal(good.fires('A11Y-3'), false);
});

test('a screen that forgets the bottom of the phone', () => {
  const bad = gate({
    'app/noinset.tsx': `${SCREEN_HEAD}
export default function S() { return (<View><Text>Hello</Text></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(bad.fires('OGN-IOS-003'), true);

  const byHook = gate({
    'app/hook.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Text>Hello</Text></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(byHook.fires('OGN-IOS-003'), false);

  const bySafeArea = gate({
    'app/safe.tsx': `import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemePreference } from '../lib/themePreference';
export default function S() { return (<SafeAreaView edges={['top','bottom']}><View><Text>Hello</Text></View></SafeAreaView>); }
`,
  });
  assert.equal(bySafeArea.fires('OGN-IOS-003'), false);
});

test('a box locked to a height with words inside it', () => {
  const bad = gate({
    'app/locked.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><View style={styles.row}><Text>Overcomers</Text></View></View>); }
const styles = StyleSheet.create({ row: { height: 22 } });
`,
  });
  assert.equal(bad.fires('OGN-IOS-006'), true);
  assert.equal(bad.fires('AND-A11Y-03'), true);

  const good = gate({
    'app/grows.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><View style={styles.row}><Text>Overcomers</Text></View></View>); }
const styles = StyleSheet.create({ row: { minHeight: 22 } });
`,
  });
  assert.equal(good.fires('OGN-IOS-006'), false);
});

test('a badge pushed outside a rounded parent, where it gets clipped', () => {
  const bad = gate({
    'app/badge.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><View style={styles.ring}><View style={styles.dot} /></View></View>); }
const styles = StyleSheet.create({ ring: { borderRadius: 43, overflow: 'hidden' }, dot: { position: 'absolute', left: -6, bottom: -3, width: 12, height: 12 } });
`,
  });
  assert.equal(bad.fires('OGN-IOS-005'), true);

  const good = gate({
    'app/badge2.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><View style={styles.pad}><View style={styles.ring} /><View style={styles.dot} /></View></View>); }
const styles = StyleSheet.create({ pad: { padding: 8 }, ring: { borderRadius: 43, overflow: 'hidden' }, dot: { position: 'absolute', left: 2, bottom: 2, width: 12, height: 12 } });
`,
  });
  assert.equal(good.fires('OGN-IOS-005'), false);
});

test('brand artwork cropped by a "cover" fit', () => {
  const bad = gate({
    'app/crest.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Image accessibilityLabel="Crest" source={require('../assets/icon.png')} resizeMode="cover" style={styles.seal} /></View>); }
const styles = StyleSheet.create({ seal: { width: 224, height: 124 } });
`,
  });
  assert.equal(bad.fires('OGN-IOS-002'), true);
  assert.match(bad.findings('OGN-IOS-002')[0].detail, /contain/);

  const good = gate({
    'app/crest2.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Image accessibilityLabel="Crest" source={require('../assets/icon.png')} resizeMode="contain" style={styles.seal} /></View>); }
const styles = StyleSheet.create({ seal: { width: 224, height: 124 } });
`,
  });
  assert.equal(good.fires('OGN-IOS-002'), false);
});

test('a photo squeezed into the wrong shape, even when it is not brand art', () => {
  const bad = gate({
    'app/hero.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Image accessibilityLabel="Broadcast" source={require('../assets/wide.png')} resizeMode="cover" style={styles.hero} /></View>); }
const styles = StyleSheet.create({ hero: { width: 300, height: 300 } });
`,
    'assets/wide.png': pngBytes(1600, 400),
  });
  assert.equal(bad.fires('OGN-IOS-002'), true);
  assert.match(bad.findings('OGN-IOS-002')[0].detail, /1600x400/);

  const good = gate({
    'app/hero2.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Image accessibilityLabel="Broadcast" source={require('../assets/wide.png')} resizeMode="cover" style={styles.hero} /></View>); }
const styles = StyleSheet.create({ hero: { width: 400, height: 100 } });
`,
    'assets/wide.png': pngBytes(1600, 400),
  });
  assert.equal(good.fires('OGN-IOS-002'), false, 'the box matches the picture, so cover crops nothing');
});

test('demo and placeholder content a real person could see', () => {
  const bad = gate({
    'app/home.tsx': `${SCREEN_HEAD}
const art = { hero: require('../assets/ref/broadcast_placeholder.jpg') };
const stats = ['42+', '1.2M+'];
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Text>{stats[0]}</Text></View>); }
const styles = StyleSheet.create({});
`,
    'assets/ref/broadcast_placeholder.jpg': 'not really a jpeg',
  });
  assert.equal(bad.fires('OGN-IOS-013'), true);
  assert.equal(bad.fires('NO-UNVERIFIED-CLAIMS'), true);
  assert.ok(bad.findings('OGN-IOS-013').some((f) => /placeholder/i.test(f.detail)));

  const good = gate({
    'app/home2.tsx': `${SCREEN_HEAD}
export default function S({ countries }: { countries: number }) { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Text>{countries}</Text></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(good.fires('OGN-IOS-013'), false);
  assert.equal(good.fires('NO-UNVERIFIED-CLAIMS'), false);
});

test('stand-in words a member could read on screen', () => {
  const bad = gate({
    'app/copy.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Text>Lorem ipsum dolor sit amet, for now.</Text></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(bad.fires('OGN-IOS-013'), true);

  const good = gate({
    'app/copy2.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Text>No stories yet. When somebody shares one, it will be right here. Check back soon.</Text></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(good.fires('OGN-IOS-013'), false, 'an honest empty state is good copy, not a placeholder');
  assert.equal(good.fires('NO-UNDELIVERABLE-PROMISES'), false, '"check back soon" on an empty list is not a promise the build cannot keep');
});

test('a note a developer left for a developer', () => {
  const bad = gate({ 'lib/x.ts': "// TODO: work out why the delete does nothing\nexport const a = 1;\n" });
  assert.equal(bad.fires('GATE-NO-DEV-MARKERS'), true);
  assert.match(bad.findings('GATE-NO-DEV-MARKERS')[0].detail, /TODO/);

  const good = gate({ 'lib/y.ts': "// The delete returns the row so a no-op cannot look like a success.\nexport const a = 1;\n" });
  assert.equal(good.fires('GATE-NO-DEV-MARKERS'), false);
});

test('colours typed into a screen are counted, not hunted, and the limit is a setting', () => {
  const many = `import { StyleSheet } from 'react-native';
export const styles = StyleSheet.create({ a: { color: '#111111' }, b: { color: '#222222' }, c: { color: '#333333' }, d: { color: '#444444' }, e: { color: '#555555' }, f: { color: '#666666' }, g: { color: '#777777' }, h: { color: 'rgba(0,0,0,0.5)' } });
`;
  const strict = gate({ 'lib/palette.ts': many }, { colorMax: 6 });
  assert.equal(strict.fires('GATE-COLOR-LITERALS'), true);
  assert.match(strict.findings('GATE-COLOR-LITERALS')[0].detail, /8 colours/);

  const relaxed = gate({ 'lib/palette.ts': many }, { colorMax: 20 });
  assert.equal(relaxed.fires('GATE-COLOR-LITERALS'), false, 'the threshold is genuinely a setting');

  const few = gate({ 'lib/small.ts': "import { StyleSheet } from 'react-native';\nexport const s = StyleSheet.create({ a: { color: '#111111' } });\n" });
  assert.equal(few.fires('GATE-COLOR-LITERALS'), false);

  const theme = gate({}, { colorMax: 0 });
  assert.equal(theme.fires('GATE-COLOR-LITERALS'), false, 'lib/theme.ts is where colours are supposed to live');
});

test('something failed and the person was told nothing', () => {
  const empty = gate({ 'lib/a.ts': "export async function go() { try { await fetch('https://x', { signal: AbortSignal.timeout(5000) }); } catch { } }\n" });
  assert.equal(empty.fires('NO-SILENT-FAILURE'), true);

  const logged = gate({ 'lib/b.ts': "export async function go() { try { await fetch('https://x', { signal: AbortSignal.timeout(5000) }); } catch (e) { console.log(e); } }\n" });
  assert.equal(logged.fires('NO-SILENT-FAILURE'), true);
  assert.match(logged.findings('NO-SILENT-FAILURE')[0].detail, /console/);

  const handled = gate({ 'lib/c.ts': "export async function go(show: (m: string) => void) { try { await fetch('https://x', { signal: AbortSignal.timeout(5000) }); } catch { show('We could not load that just now. Please try again.'); } }\n" });
  assert.equal(handled.fires('NO-SILENT-FAILURE'), false);
});

test('developer words in something a member reads', () => {
  const bad = gate({
    'app/acct.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<Pressable accessibilityRole="button" accessibilityLabel="Create" style={styles.b} onPress={() => Alert.alert('Account created', 'Check email confirmation settings in Supabase if login does not begin immediately.')}><Text>Create</Text></Pressable>); }
const styles = StyleSheet.create({ b: { minHeight: 48, minWidth: 48 } });
`,
  });
  assert.equal(bad.fires('NO-DEV-LANGUAGE'), true);
  assert.equal(bad.findings('NO-DEV-LANGUAGE').length, 1, 'one problem, reported once');

  // A file that matches on database phrases precisely so a member never sees one
  // must not be punished for naming them.
  const needles = gate({
    'lib/errorMessages.ts': "export function friendly(raw: string) {\n  if (raw.includes('null value in column')) return 'Something was missing. Please fill that in and try again.';\n  if (raw.includes('duplicate key')) return 'That one is already saved.';\n  return 'Something went wrong. Please try again.';\n}\n",
  });
  assert.equal(needles.fires('NO-DEV-LANGUAGE'), false, 'a phrase being matched on is a needle, not copy');

  const good = gate({
    'app/acct2.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<Pressable accessibilityRole="button" accessibilityLabel="Create" style={styles.b} onPress={() => Alert.alert('Welcome', 'Your account is ready. Check your email for a note from us.')}><Text>Create</Text></Pressable>); }
const styles = StyleSheet.create({ b: { minHeight: 48, minWidth: 48 } });
`,
  });
  assert.equal(good.fires('NO-DEV-LANGUAGE'), false);
});

test('a network call that can hang forever', () => {
  const bad = gate({ 'lib/net.ts': "export async function go() { const r = await fetch('https://example.com/x'); return r.json(); }\n" });
  assert.equal(bad.fires('GATE-NET-TIMEOUT'), true);

  const viaHelper = gate({ 'lib/net2.ts': "import { fetchWithTimeout } from './requestTimeout';\nexport async function go() { const r = await fetchWithTimeout('https://example.com/x'); return r.json(); }\n" });
  assert.equal(viaHelper.fires('GATE-NET-TIMEOUT'), false);

  const viaSignal = gate({ 'lib/net3.ts': "export async function go() { const r = await fetch('https://example.com/x', { signal: AbortSignal.timeout(15000) }); return r.json(); }\n" });
  assert.equal(viaSignal.fires('GATE-NET-TIMEOUT'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// app.json
// ─────────────────────────────────────────────────────────────────────────────

test('the app’s identity is pinned, and a drift in it is a blocker', () => {
  const ok = gate({});
  assert.equal(ok.fires('GATE-IDENTITY-LOCK'), false);

  const drifted = JSON.parse(JSON.stringify(APP_JSON));
  drifted.expo.ios.bundleIdentifier = 'com.overcomers.globalnetwork.app2';
  drifted.expo.extra.eas.projectId = '00000000-0000-0000-0000-000000000000';
  const bad = gate({}, { appJson: drifted });
  assert.equal(bad.fires('GATE-IDENTITY-LOCK'), true);
  assert.equal(bad.findings('GATE-IDENTITY-LOCK').length, 2);
  assert.equal(RULES_BY_ID['GATE-IDENTITY-LOCK'].severity, 'blocker');
});

test('an icon or splash that is named but not on disk', () => {
  const ok = gate({});
  assert.equal(ok.fires('GATE-APP-JSON-ASSETS'), false);

  const missing = JSON.parse(JSON.stringify(APP_JSON));
  missing.expo.icon = './assets/not-there.png';
  delete missing.expo.scheme;
  const bad = gate({}, { appJson: missing });
  assert.equal(bad.fires('GATE-APP-JSON-ASSETS'), true);
  assert.ok(bad.findings('GATE-APP-JSON-ASSETS').some((f) => /not-there\.png/.test(f.detail)));
  assert.ok(bad.findings('GATE-APP-JSON-ASSETS').some((f) => /app link/.test(f.detail)));
});

test('a permission that is asked for and never used', () => {
  const unused = JSON.parse(JSON.stringify(APP_JSON));
  unused.expo.ios.infoPlist.NSPhotoLibraryUsageDescription = 'OGN lets you choose photos and videos for your profile and ministry stories.';
  const bad = gate({
    'components/Pick.tsx': "import * as ImagePicker from 'expo-image-picker';\nexport const pick = () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });\n",
  }, { appJson: unused });
  assert.equal(bad.fires('OGN-IOS-009'), true);
  assert.ok(bad.findings('OGN-IOS-009').some((f) => /NSPhotoLibraryUsageDescription/.test(f.detail)),
    'the picker needs no library permission, so declaring one is exactly what gets an app rejected');

  const used = JSON.parse(JSON.stringify(APP_JSON));
  const good = gate({
    'components/Cam.tsx': "import * as ImagePicker from 'expo-image-picker';\nexport const shoot = () => ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });\n",
  }, { appJson: used });
  assert.equal(good.fires('OGN-IOS-009'), false);
});

test('the old unlimited storage permission Google Play no longer accepts', () => {
  const legacy = JSON.parse(JSON.stringify(APP_JSON));
  legacy.expo.android.permissions = ['android.permission.READ_EXTERNAL_STORAGE'];
  const bad = gate({}, { appJson: legacy });
  assert.equal(bad.fires('AND-PERM-02'), true);

  const modern = JSON.parse(JSON.stringify(APP_JSON));
  modern.expo.android.permissions = ['android.permission.POST_NOTIFICATIONS'];
  const good = gate({ 'lib/push.ts': "import * as Notifications from 'expo-notifications';\nexport const go = () => Notifications.getExpoPushTokenAsync();\n" }, { appJson: modern });
  assert.equal(good.fires('AND-PERM-02'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Secrets — the promise that matters most
// ─────────────────────────────────────────────────────────────────────────────

// Built from pieces at run time, never written out as one literal.
// A realistic-looking key sitting in the source is a key as far as every
// scanner is concerned. The detector under test sees the assembled string
// and behaves exactly the same.
const PLANTED = ['sk', 'live', 'A'.repeat(33)].join('_');

test('a key typed into the code is found', () => {
  const bad = gate({ 'lib/pay.ts': `const stripeSecretKey = '${PLANTED}';\nexport const key = stripeSecretKey;\n` });
  assert.equal(bad.fires('GATE-NO-SECRETS'), true);
  assert.match(bad.findings('GATE-NO-SECRETS')[0].detail, /stripeSecretKey/, 'the report must name the variable so it can be found');

  const good = gate({ 'lib/pay2.ts': "export const key = process.env.EXPO_PUBLIC_GIVING_URL ?? '';\n" });
  assert.equal(good.fires('GATE-NO-SECRETS'), false);
});

test('the secret detector never prints the secret — not in the report, not in the JSON, not truncated', () => {
  const root = fixture({
    'lib/pay.ts': `const stripeSecretKey = '${PLANTED}';\nconst apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadgoeshere.signature';\nexport const k = stripeSecretKey + apiKey;\n`,
  });
  const opts = { platform: 'both', json: false, baseline: null, writeBaseline: null, root, colorMax: 6, quiet: false };
  const report = runGate(opts);
  const rule = report.rules.find((r) => r.id === 'GATE-NO-SECRETS');
  assert.equal(rule.status, 'fail', 'it must actually have found them, or this test proves nothing');
  assert.equal(rule.findings.length, 2);

  const human = renderReport(report, opts);
  const { ctx, ...clean } = report;
  const json = JSON.stringify(clean);

  for (const [label, text] of [['the human report', human], ['the JSON', json]]) {
    assert.ok(!text.includes(PLANTED), `${label} printed the whole secret`);
    for (let n = 8; n <= PLANTED.length; n += 1) {
      assert.ok(!text.includes(PLANTED.slice(0, n)), `${label} printed the first ${n} characters of the secret`);
      assert.ok(!text.includes(PLANTED.slice(-n)), `${label} printed the last ${n} characters of the secret`);
    }
    assert.ok(!text.includes('payloadgoeshere'), `${label} printed part of the token`);
    assert.ok(text.includes('stripeSecretKey'), `${label} should still name the variable`);
    assert.ok(/\d+ characters/.test(text), `${label} should describe the shape instead`);
  }
});

test('the whole report is safe to paste, whatever detector produced it', () => {
  const root = fixture({ 'lib/pay.ts': `const authToken = '${PLANTED}';\nexport const t = authToken;\n` });
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    main(['--root', root]);
    main(['--root', root, '--json']);
  } finally {
    console.log = realLog;
  }
  const everythingPrinted = lines.join('\n');
  assert.ok(everythingPrinted.length > 500, 'something was printed');
  assert.ok(!everythingPrinted.includes(PLANTED));
  assert.ok(!everythingPrinted.includes(PLANTED.slice(0, 10)));
});

// ─────────────────────────────────────────────────────────────────────────────
// What stops a release, and what does not
// ─────────────────────────────────────────────────────────────────────────────

test('only a blocker changes the exit code', () => {
  const clean = gate({});
  assert.equal(clean.report.totals.blockersFailing, 0, 'the plain fixture must have no blockers, or this test proves nothing');
  assert.equal(clean.report.exitCode, 0);

  // A small tap target is 'high'. Serious, and not a reason to stop a release.
  const highOnly = gate({
    'app/small.tsx': `${SCREEN_HEAD}
export default function S() { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.b} onPress={() => {}}><Ionicons name="close" size={16} /></Pressable></View>); }
const styles = StyleSheet.create({ b: { width: 30, height: 30 } });
`,
  });
  assert.ok(highOnly.report.totals.failed > 0, 'something is failing');
  assert.equal(highOnly.report.totals.blockersFailing, 0);
  assert.equal(highOnly.report.exitCode, 0, 'a high finding must not stop the release');

  // A drifted bundle id is a blocker, and it must.
  const drifted = JSON.parse(JSON.stringify(APP_JSON));
  drifted.expo.android.package = 'com.something.else';
  const blocked = gate({}, { appJson: drifted });
  assert.equal(blocked.report.totals.blockersFailing, 1);
  assert.equal(blocked.report.exitCode, 1);
});

test('the exit code the command line gives back matches the report', () => {
  const okRoot = fixture({});
  const drifted = JSON.parse(JSON.stringify(APP_JSON));
  drifted.expo.scheme = 'somethingelse';
  const badRoot = fixture({}, drifted);
  const quiet = () => { const real = console.log; console.log = () => {}; return () => { console.log = real; }; };

  let restore = quiet();
  const okCode = main(['--root', okRoot, '--json']);
  restore();
  assert.equal(okCode, 0);

  restore = quiet();
  const badCode = main(['--root', badRoot, '--json']);
  restore();
  assert.equal(badCode, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// The baseline — how the gate goes on today without stopping the release
// ─────────────────────────────────────────────────────────────────────────────

const THREE_UNLABELLED = `import React from 'react';
import { Image, View } from 'react-native';
export function Gallery({ dark }: { dark: boolean }) {
  return (<View><Image source={{ uri: 'a' }} /><Image source={{ uri: 'b' }} /><Image source={{ uri: 'c' }} /></View>);
}
`;

test('an agreed violation is set aside, and one more than agreed is not', () => {
  const files = { 'components/Gallery.tsx': THREE_UNLABELLED };
  const before = gate(files);
  assert.equal(before.findings('A11Y-2').length, 3);

  const root = fixture(files);
  const baselinePath = join(root, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({
    waived: [{ rule: 'A11Y-2', file: 'components/Gallery.tsx', allow: 3 }],
  }));
  const opts = { platform: 'both', json: false, baseline: baselinePath, writeBaseline: null, root, colorMax: 6, quiet: false };
  const waived = runGate(opts);
  const rule = waived.rules.find((r) => r.id === 'A11Y-2');
  assert.equal(rule.status, 'pass', 'three agreed, three found, nothing left');
  assert.equal(rule.waived, 3);
  assert.equal(waived.totals.waivedFindings >= 3, true);

  // One more picture than was agreed, and the gate speaks up again.
  writeFileSync(join(root, 'components/Gallery.tsx'), THREE_UNLABELLED.replace("<Image source={{ uri: 'c' }} />", "<Image source={{ uri: 'c' }} /><Image source={{ uri: 'd' }} />"));
  const after = runGate(opts);
  const ruleAfter = after.rules.find((r) => r.id === 'A11Y-2');
  assert.equal(ruleAfter.status, 'fail', 'green on what was agreed, never green on what is new');
  assert.equal(ruleAfter.findings.length, 1);
  assert.equal(ruleAfter.waived, 3);
});

test('a baseline only forgives the file it names', () => {
  const root = fixture({ 'components/A.tsx': THREE_UNLABELLED, 'components/B.tsx': THREE_UNLABELLED.replace('Gallery', 'Other') });
  const baselinePath = join(root, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify({ waived: [{ rule: 'A11Y-2', file: 'components/A.tsx', allow: 3 }] }));
  const report = runGate({ platform: 'both', json: false, baseline: baselinePath, writeBaseline: null, root, colorMax: 6, quiet: false });
  const rule = report.rules.find((r) => r.id === 'A11Y-2');
  assert.equal(rule.status, 'fail');
  assert.equal(rule.findings.length, 3);
  assert.ok(rule.findings.every((f) => f.file === 'components/B.tsx'));
});

test('a baseline file that is not there forgives nothing and says so', () => {
  const root = fixture({ 'components/Gallery.tsx': THREE_UNLABELLED });
  const report = runGate({ platform: 'both', json: false, baseline: join(root, 'nope.json'), writeBaseline: null, root, colorMax: 6, quiet: false });
  assert.equal(report.baseline.missing, true);
  assert.equal(report.totals.waivedFindings, 0);
  assert.equal(report.rules.find((r) => r.id === 'A11Y-2').status, 'fail');
  assert.match(renderReport(report, { quiet: false }), /does not exist/);
});

test('a written baseline, read back, makes the same run clean', () => {
  const root = fixture({ 'components/Gallery.tsx': THREE_UNLABELLED });
  const opts = { platform: 'both', json: false, baseline: null, writeBaseline: null, root, colorMax: 6, quiet: false };
  const first = runGate(opts);
  const file = buildBaselineFile(first);
  assert.ok(file.totalWaived > 0);
  assert.ok(file.note.includes('set aside'));
  const path = join(root, 'written.json');
  writeFileSync(path, JSON.stringify(file, null, 2));

  const second = runGate({ ...opts, baseline: path });
  assert.equal(second.totals.failed, 0, 'everything that existed on day one is now agreed');
  assert.equal(second.totals.blockersFailing, 0);
  assert.equal(second.exitCode, 0);
  assert.equal(second.totals.waivedFindings, file.totalWaived);
});

test('waivers are counted, never invented', () => {
  const findings = new Map([['R1', [{ file: 'a.tsx' }, { file: 'a.tsx' }, { file: 'b.tsx' }]]]);
  const { kept, waivedTotal } = applyBaseline(findings, { waived: [{ rule: 'R1', file: 'a.tsx', allow: 1 }] });
  assert.equal(waivedTotal, 1);
  assert.equal(kept.get('R1').findings.length, 2);
  assert.equal(kept.get('R1').waived, 1);

  const none = applyBaseline(findings, { waived: [] });
  assert.equal(none.waivedTotal, 0);
  assert.equal(none.kept.get('R1').findings.length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage — the promise that a skipped rule never reads as a pass
// ─────────────────────────────────────────────────────────────────────────────

test('every rule is accounted for, and the numbers add up', () => {
  const { report } = gate({});
  const t = report.totals;
  assert.equal(t.applicable, report.rules.length);
  assert.equal(t.checkedStatically + t.notChecked, t.applicable, 'a rule is either checked or it is not; there is no third state');
  assert.equal(t.passed + t.failed, t.checkedStatically);
  assert.equal(t.findings, report.rules.filter((r) => r.status === 'fail').reduce((n, r) => n + r.findings.length, 0));
});

test('a rule that needs a phone is never reported as clean', () => {
  const { report } = gate({});
  const device = report.rules.filter((r) => RULES_BY_ID[r.id].kind === 'device');
  assert.ok(device.length > 0, 'some rules genuinely need a phone');
  for (const r of device) {
    assert.equal(r.status, 'not-checked', `${r.id} must not be counted either way`);
    assert.equal(r.findings.length, 0);
  }
  assert.equal(report.totals.notChecked >= device.length, true);

  const text = renderReport(report, { quiet: false });
  assert.match(text, /could NOT be checked here and were NOT counted as passing/);
  for (const r of device) assert.ok(text.includes(r.id), `${r.id} must be named in the report, not just counted`);
});

test('every static rule really has something behind it', () => {
  const { report } = gate({});
  const pretending = report.rules.filter((r) => r.status === 'no-detector');
  assert.deepEqual(pretending.map((r) => r.id), [], 'a static rule with no detector would silently read as unchecked');
});

test('the report says plainly whether the release is stopped', () => {
  const clean = gate({});
  assert.match(renderReport(clean.report, { quiet: false }), /No blocker is failing/);
  assert.match(renderReport(clean.report, { quiet: false }), /not the same as "everything is fine"/);

  const drifted = JSON.parse(JSON.stringify(APP_JSON));
  drifted.expo.extra.eas.projectId = 'nope';
  const blocked = gate({}, { appJson: drifted });
  const text = renderReport(blocked.report, { quiet: false });
  assert.match(text, /RELEASE BLOCKED/);
  assert.match(text, /GATE-IDENTITY-LOCK/);
});

test('half-answered rules say what is still owed on a phone', () => {
  const { report } = gate({});
  const partial = report.rules.filter((r) => r.deviceAlso && r.status !== 'not-checked');
  assert.ok(partial.length > 0, 'some rules are genuinely only half-answerable from the code');
  const text = renderReport(report, { quiet: false });
  assert.match(text, /only half-answerable from the code/);
  for (const r of partial) assert.ok(text.includes(r.deviceAlso), `${r.id} must say what is missing`);
});

test('a detector that throws is reported as unrun, never as a pass', () => {
  const { report } = gate({});
  assert.deepEqual(report.errors, [], 'no detector should be throwing against a plain app');
  // And when one does, the report has a place to say so.
  const pretend = { ...report, errors: [{ rule: 'A11Y-1', message: 'boom' }] };
  assert.match(renderReport(pretend, { quiet: false }), /FAILED TO RUN \(treat as unchecked\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// The rest of the detectors
// ─────────────────────────────────────────────────────────────────────────────

test('something that looks tappable and does nothing', () => {
  const bad = gate({
    'app/media.tsx': `${SCREEN_HEAD}
export default function S() {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Text style={styles.link}>View all</Text><Pressable accessibilityRole="button" accessibilityLabel="Search" style={styles.b} onPress={() => Alert.alert('Media Search', 'Use the category tabs to browse instead.')}><Text>Search</Text></Pressable></View>);
}
const styles = StyleSheet.create({ link: { fontSize: 14 }, b: { minHeight: 48, minWidth: 48 } });
`,
  });
  assert.equal(bad.fires('NO-DEAD-CONTROLS'), true);
  assert.equal(bad.findings('NO-DEAD-CONTROLS').length, 2);

  const good = gate({
    'app/media2.tsx': `${SCREEN_HEAD}
export default function S({ onAll, onSearch }: { onAll: () => void; onSearch: () => void }) {
  const insets = useSafeAreaInsets();
  return (<View style={{ paddingBottom: insets.bottom }}><Pressable accessibilityRole="button" accessibilityLabel="View all sermons" style={styles.b} onPress={onAll}><Text style={styles.link}>View all</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Search" style={styles.b} onPress={onSearch}><Text>Search</Text></Pressable></View>);
}
const styles = StyleSheet.create({ link: { fontSize: 14 }, b: { minHeight: 48, minWidth: 48 } });
`,
  });
  assert.equal(good.fires('NO-DEAD-CONTROLS'), false);
});

test('invented sample data standing in for a failed query', () => {
  const bad = gate({ 'lib/content.ts': "import { sermons } from '../data/mockData';\nexport async function get() { return sermons; }\n" });
  assert.equal(bad.fires('NO-MOCK-FALLBACK'), true);

  const good = gate({ 'lib/content2.ts': "export async function get() { return []; }\n" });
  assert.equal(good.fires('NO-MOCK-FALLBACK'), false);
});

test('a member’s story filled in with somebody else’s words', () => {
  const bad = gate({ 'app/(tabs)/index.tsx': "const fallback = { body: 'x' };\nexport const body = (story: any) => story.body || fallback.body;\n" });
  assert.equal(bad.fires('NO-FABRICATED-STORY-COPY'), true);

  const good = gate({ 'app/(tabs)/index.tsx': "export const body = (story: any) => story.body ?? '';\n" });
  assert.equal(good.fires('NO-FABRICATED-STORY-COPY'), false);
});

test('a pop-up on Android that the back button cannot close', () => {
  const bad = gate({
    'app/modal.tsx': `${SCREEN_HEAD}
import { Modal } from 'react-native';
export default function S({ open }: { open: boolean }) { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Modal visible={open}><Text>Hi</Text></Modal></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(bad.fires('AND-BACK-02'), true);

  const good = gate({
    'app/modal2.tsx': `${SCREEN_HEAD}
import { Modal } from 'react-native';
export default function S({ open, close }: { open: boolean; close: () => void }) { const insets = useSafeAreaInsets(); return (<View style={{ paddingBottom: insets.bottom }}><Modal visible={open} onRequestClose={close}><Text>Hi</Text></Modal></View>); }
const styles = StyleSheet.create({});
`,
  });
  assert.equal(good.fires('AND-BACK-02'), false);
});

test('the command line is read the way it is documented', () => {
  assert.equal(parseArgs([]).platform, 'both');
  assert.equal(parseArgs(['--platform', 'ios']).platform, 'ios');
  assert.equal(parseArgs(['--platform=android']).platform, 'android');
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs(['--color-max', '12']).colorMax, 12);
  assert.equal(parseArgs(['--baseline', 'b.json']).baseline, 'b.json');
  assert.throws(() => parseArgs(['--platform', 'windows']), /ios, android or both/);
  assert.throws(() => parseArgs(['--color-max', 'lots']), /zero or more/);
  assert.throws(() => parseArgs(['--nonsense']), /do not know the option/);
});

test('asking for one platform really runs fewer rules', () => {
  const ios = gate({}, { platform: 'ios' });
  const android = gate({}, { platform: 'android' });
  const both = gate({}, { platform: 'both' });
  assert.ok(ios.report.totals.applicable < both.report.totals.applicable);
  assert.ok(android.report.totals.applicable < both.report.totals.applicable);
  assert.equal(ios.rule('AND-TOUCH-01'), undefined, 'Google’s own rules are not applied to an Apple run');
  assert.equal(android.rule('OGN-IOS-011'), undefined);
  assert.ok(both.rule('AND-TOUCH-01') && both.rule('OGN-IOS-011'));
});

test('a baseline written for the whole repository can be read back', () => {
  const path = join(dirname(new URL(import.meta.url).pathname), 'baseline.json');
  if (!existsSync(path)) return;                      // not written yet on a fresh clone
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(Array.isArray(data.waived));
  assert.equal(typeof data.totalWaived, 'number');
  assert.equal(data.totalWaived, data.waived.reduce((n, w) => n + w.allow, 0), 'the count in the file must match the file');
  for (const w of data.waived) {
    assert.ok(RULES_BY_ID[w.rule], `${w.rule} is waived but is not a rule any more — clean this file up`);
    assert.ok(w.file && typeof w.allow === 'number' && w.allow > 0);
  }
});
