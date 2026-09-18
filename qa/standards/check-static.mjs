#!/usr/bin/env node
/**
 * The release gate. It reads the app's own source and decides whether today's
 * build is fit to put in front of a congregation.
 *
 * Run it:
 *
 *   node qa/standards/check-static.mjs                      the full report
 *   node qa/standards/check-static.mjs --platform ios        Apple's rules only
 *   node qa/standards/check-static.mjs --platform android    Google's rules only
 *   node qa/standards/check-static.mjs --json                for another program
 *   node qa/standards/check-static.mjs --baseline qa/standards/baseline.json
 *   node qa/standards/check-static.mjs --write-baseline qa/standards/baseline.json
 *
 * It exits 0 when nothing marked 'blocker' is failing, and 1 when something is.
 * Nothing else changes the exit code: a hundred medium findings will not stop a
 * release, and one blocker will.
 *
 * ── Two promises this file keeps ──────────────────────────────────────────────
 *
 * 1. A rule nobody checked is never printed as a pass. Nine of the hundred
 *    rules need a real phone, a live database, a built bundle or the internet.
 *    They are counted separately, listed by name, and the coverage line at the
 *    bottom says how many there were. The owner has been handed a green report
 *    before that was green because the hard half was skipped.
 *
 * 2. It never prints a secret. The secret detector reports the file, the line
 *    and the variable name, plus how long the value was and what shape it had —
 *    and never a single character of the value itself. A report gets pasted into
 *    chats and pull requests; it must be safe to paste.
 *
 * ── How it reads TypeScript without a parser ─────────────────────────────────
 *
 * On purpose, it has no dependencies at all — only what Node ships with — so it
 * cannot rot when a package updates on release morning. Instead of a real
 * compiler it builds three cheap models of each file:
 *
 *   masked source   every string body and comment body replaced by spaces of
 *                   the same length, so a regex looking for structure can never
 *                   match something that was really just a word in a sentence.
 *   the style map   StyleSheet.create({...}) parsed into name -> properties, so
 *                   a rule can ask how tall styles.iconBtn actually is.
 *   the JSX tree    every element with its attributes, its parent and its
 *                   children, so a rule can ask what is inside a Pressable.
 *
 * That is enough for most of the standard and honest about the rest. Where a
 * rule is only half-answerable this way, its `deviceAlso` line says what is
 * still owed, and the report prints it.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, RULES_BY_ID, IDENTITY, THRESHOLDS, rulesFor, groupByTheme, SEVERITY_ORDER } from './rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// What was asked for
// ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    platform: 'both',
    json: false,
    baseline: null,
    writeBaseline: null,
    root: DEFAULT_ROOT,
    colorMax: THRESHOLDS.colorLiteralsPerFile,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--platform') opts.platform = next();
    else if (a.startsWith('--platform=')) opts.platform = a.slice(11);
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--baseline') opts.baseline = next();
    else if (a.startsWith('--baseline=')) opts.baseline = a.slice(11);
    else if (a === '--write-baseline') opts.writeBaseline = next();
    else if (a.startsWith('--write-baseline=')) opts.writeBaseline = a.slice(17);
    else if (a === '--root') opts.root = next();
    else if (a.startsWith('--root=')) opts.root = a.slice(7);
    else if (a === '--color-max') opts.colorMax = Number(next());
    else if (a.startsWith('--color-max=')) opts.colorMax = Number(a.slice(12));
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`I do not know the option ${a}. Try --help.`);
  }
  if (!['ios', 'android', 'both'].includes(opts.platform)) {
    throw new Error(`--platform must be ios, android or both. I was given "${opts.platform}".`);
  }
  if (!Number.isFinite(opts.colorMax) || opts.colorMax < 0) {
    throw new Error('--color-max needs a number that is zero or more.');
  }
  return opts;
}

const HELP = `
The Overcomers Global Network release gate.

  node qa/standards/check-static.mjs [options]

  --platform ios|android|both   Which store's standard to apply. Default: both.
  --json                        Print the whole report as JSON instead.
  --baseline <file>             Forgive the violations agreed in this file.
  --write-baseline <file>       Write today's violations out as a new baseline.
  --color-max <n>               Colour literals allowed per file. Default: ${THRESHOLDS.colorLiteralsPerFile}.
  --root <dir>                  The app folder to read. Default: the repo root.
  --quiet                       Only print the failures and the summary.

Exit code is 0 when no blocker is failing, and 1 when one is.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Finding the files
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_DIRS = ['app', 'components', 'lib'];
const SCAN_EXT = new Set(['.tsx', '.ts', '.jsx', '.js']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'dist-ios', 'dist-android', 'build', '.expo', '__tests__']);

export function walkSource(root, dirs = SCAN_DIRS) {
  const found = [];
  const visit = (abs) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('._') || e.name.startsWith('.')) continue;
      const full = join(abs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name)) continue;
        visit(full);
      } else if (SCAN_EXT.has(extname(e.name)) && !e.name.endsWith('.d.ts')) {
        found.push(full);
      }
    }
  };
  for (const d of dirs) {
    const abs = join(root, d);
    if (existsSync(abs)) visit(abs);
  }
  return found.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a file three ways
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blank out the inside of every string and every comment, keeping the file the
 * same length and the same shape. Then a regex for `catch {` can never match
 * the words "catch {" inside a sentence, and a regex for a colour can never
 * match a hex code in a comment.
 */
export function maskSource(src) {
  const out = src.split('');
  const comments = [];
  const strings = [];
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      let j = i + 2;
      while (j < src.length && src[j] !== '\n') j += 1;
      comments.push({ start: i, end: j, text: src.slice(i, j) });
      blank(i, j); i = j; continue;
    }
    if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? src.length : j + 2;
      comments.push({ start: i, end: j, text: src.slice(i, j) });
      blank(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') break;
        j += 1;
      }
      strings.push({ start: i, end: j + 1, quote: c, text: src.slice(i + 1, j) });
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth += 1; j += 2; continue; }
        if (depth > 0 && src[j] === '}') { depth -= 1; j += 1; continue; }
        if (depth === 0 && src[j] === '`') break;
        j += 1;
      }
      strings.push({ start: i, end: j + 1, quote: '`', text: src.slice(i + 1, j) });
      // Template holes keep their code; only the literal chunks are blanked.
      let k = i + 1;
      while (k < j) {
        if (src[k] === '$' && src[k + 1] === '{') {
          let d = 1; let m = k + 2;
          while (m < j && d > 0) { if (src[m] === '{') d += 1; else if (src[m] === '}') d -= 1; m += 1; }
          k = m; continue;
        }
        if (out[k] !== '\n') out[k] = ' ';
        k += 1;
      }
      i = j + 1; continue;
    }
    i += 1;
  }
  return { masked: out.join(''), comments, strings };
}

/** Turn a byte offset into a 1-based line number. */
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

function makeLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** Walk from `open` (an index pointing at a bracket) to its partner. */
function matchBracket(masked, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const close = pairs[masked[open]];
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === masked[open]) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Parse an object literal into its top-level keys. Values come back as raw
 * source, because a rule that wants a number can read one and a rule that wants
 * to see a ternary needs the text.
 */
export function parseObjectLiteral(src, masked, braceIndex) {
  const end = matchBracket(masked, braceIndex);
  if (end === -1) return { entries: [], end: braceIndex };
  const entries = [];
  let i = braceIndex + 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(masked[i])) i += 1;
    if (i >= end) break;
    const keyMatch = /^(?:\.\.\.)?\s*(?:\[[^\]]*\]|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)/.exec(masked.slice(i, end));
    if (!keyMatch) { i += 1; continue; }
    const rawKey = src.slice(i, i + keyMatch[0].length).trim();
    let j = i + keyMatch[0].length;
    while (j < end && /\s/.test(masked[j])) j += 1;
    if (masked[j] !== ':') {
      // A spread or a shorthand. Record it so a rule can see the name.
      entries.push({ key: rawKey.replace(/^\.\.\./, '…'), value: rawKey, start: i, end: j });
      i = j; continue;
    }
    j += 1;
    while (j < end && /\s/.test(masked[j])) j += 1;
    const valueStart = j;
    let depth = 0;
    while (j < end) {
      const c = masked[j];
      if (c === '{' || c === '(' || c === '[') depth += 1;
      else if (c === '}' || c === ')' || c === ']') depth -= 1;
      else if (c === ',' && depth === 0) break;
      j += 1;
    }
    entries.push({
      key: rawKey.replace(/^['"]|['"]$/g, ''),
      value: src.slice(valueStart, j).trim(),
      start: valueStart,
      end: j,
    });
    i = j + 1;
  }
  return { entries, end };
}

/** name -> { prop: rawValue } for every StyleSheet.create in the file. */
export function parseStyleSheets(src, masked) {
  const styles = {};
  const re = /StyleSheet\.create\s*\(/g;
  let m;
  while ((m = re.exec(masked))) {
    let i = m.index + m[0].length;
    while (i < masked.length && /\s/.test(masked[i])) i += 1;
    if (masked[i] !== '{') continue;
    const { entries } = parseObjectLiteral(src, masked, i);
    for (const e of entries) {
      const brace = e.value.indexOf('{');
      if (brace !== 0) continue;
      const inner = parseObjectLiteral(e.value, maskSource(e.value).masked, 0);
      const props = {};
      for (const p of inner.entries) props[p.key] = p.value;
      styles[e.key] = { props, line: 0, start: e.start };
    }
  }
  return styles;
}

// ─────────────────────────────────────────────────────────────────────────────
// The JSX tree
// ─────────────────────────────────────────────────────────────────────────────

const JSX_PRECEDERS = new Set(['(', '{', '[', ',', '>', '}', '=', '&', '|', '?', ':', ';', '\n', undefined]);
const JSX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'await', 'yield', 'do', 'else', 'default']);

function looksLikeJsxStart(masked, i) {
  const after = masked[i + 1];
  if (!after || !/[A-Za-z_$]/.test(after)) return false;
  let k = i - 1;
  while (k >= 0 && /\s/.test(masked[k])) k -= 1;
  const prev = k < 0 ? undefined : masked[k];
  if (JSX_PRECEDERS.has(prev)) return true;
  if (prev && /[\w$]/.test(prev)) {
    let s = k;
    while (s >= 0 && /[\w$]/.test(masked[s])) s -= 1;
    return JSX_KEYWORDS.has(masked.slice(s + 1, k + 1));
  }
  return false;
}

/**
 * Every element in the file, each knowing its parent and its children.
 * Good enough to ask "what is inside this Pressable" without a compiler.
 */
export function parseJsx(src, masked, lineOf) {
  const all = [];
  const stack = [];
  let i = 0;
  while (i < masked.length) {
    if (masked[i] !== '<') { i += 1; continue; }
    if (masked[i + 1] === '/') {
      const m = /^<\/\s*([A-Za-z_$][\w$.]*)?\s*>/.exec(masked.slice(i));
      if (!m) { i += 1; continue; }
      const name = m[1] || '';
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s].name === name || !name) {
          const el = stack[s];
          el.end = i;
          el.innerSrc = src.slice(el.openEnd + 1, i);
          stack.length = s;
          break;
        }
      }
      i += m[0].length; continue;
    }
    if (!looksLikeJsxStart(masked, i)) { i += 1; continue; }
    const nameMatch = /^[A-Za-z_$][\w$.]*/.exec(masked.slice(i + 1));
    if (!nameMatch) { i += 1; continue; }
    const name = nameMatch[0];
    let j = i + 1 + name.length;
    let depth = 0;
    let gt = -1;
    while (j < masked.length) {
      const c = masked[j];
      if (c === '{' || c === '(' || c === '[') depth += 1;
      else if (c === '}' || c === ')' || c === ']') depth -= 1;
      else if (c === '>' && depth === 0) { gt = j; break; }
      else if (c === '<' && depth === 0 && j > i + 1 + name.length) { break; }
      j += 1;
    }
    if (gt === -1) { i += 1; continue; }
    const selfClosing = masked[gt - 1] === '/';
    const el = {
      name,
      attrs: src.slice(i + 1 + name.length, selfClosing ? gt - 1 : gt),
      start: i,
      openEnd: gt,
      end: selfClosing ? gt : null,
      line: lineOf(i),
      parent: stack.length ? stack[stack.length - 1] : null,
      children: [],
      innerSrc: '',
      selfClosing,
    };
    if (el.parent) el.parent.children.push(el);
    all.push(el);
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }
  for (const el of all) if (el.end === null) { el.end = el.openEnd; el.innerSrc = ''; }
  return all;
}

/** Every element underneath this one. */
function descendants(el, out = []) {
  for (const c of el.children) { out.push(c); descendants(c, out); }
  return out;
}

function ancestors(el) {
  const out = [];
  let p = el.parent;
  while (p) { out.push(p); p = p.parent; }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

export const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\([^)]*\)|\bhsla?\s*\([^)]*\)/g;

export function parseColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^['"`]|['"`]$/g, '');
  let m = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\s*\(([^)]*)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length < 3) return null;
    const n = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    return { r: n(parts[0]), g: n(parts[1]), b: n(parts[2]), a: parts[3] === undefined ? 1 : parseFloat(parts[3]) };
  }
  return null;
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg) + 0.05;
  const b = relativeLuminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

/** Lay a translucent colour over what is behind it. */
export function flatten(front, back) {
  if (front.a >= 1) return front;
  const a = front.a;
  return {
    r: front.r * a + back.r * (1 - a),
    g: front.g * a + back.g * (1 - a),
    b: front.b * a + back.b * (1 - a),
    a: 1,
  };
}

/** The named colours in lib/theme.ts, so `colors.gold` can be resolved. */
export function parseThemeColors(root) {
  const file = join(root, 'lib', 'theme.ts');
  if (!existsSync(file)) return {};
  const src = readFileSync(file, 'utf8');
  const { masked } = maskSource(src);
  const at = masked.indexOf('colors');
  if (at === -1) return {};
  const brace = masked.indexOf('{', at);
  if (brace === -1) return {};
  const { entries } = parseObjectLiteral(src, masked, brace);
  const out = {};
  for (const e of entries) {
    const c = parseColor(e.value);
    if (c) out[e.key] = e.value.replace(/^['"`]|['"`]$/g, '');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// One file, ready to be asked questions
// ─────────────────────────────────────────────────────────────────────────────

export function loadFile(absPath, root) {
  const src = readFileSync(absPath, 'utf8');
  const { masked, comments, strings } = maskSource(src);
  const lineOf = makeLineIndex(src);
  const styles = parseStyleSheets(src, masked);
  const elements = parseJsx(src, masked, lineOf);
  const rel = relative(root, absPath).split('\\').join('/');
  return {
    abs: absPath,
    rel,
    src,
    masked,
    comments,
    strings,
    styles,
    elements,
    lineOf,
    isRoute: rel.startsWith('app/'),
    isComponent: rel.startsWith('components/'),
    isLib: rel.startsWith('lib/'),
    /** A route the user can land on, as opposed to a layout or a 404. */
    isScreen: rel.startsWith('app/') && !/\/_layout\.tsx$/.test(rel) && !/\+not-found/.test(rel),
  };
}

// ── Asking an element about itself ───────────────────────────────────────────

const RE_CACHE = new Map();
function attrRe(name) {
  if (!RE_CACHE.has(name)) RE_CACHE.set(name, new RegExp(`(^|[\\s{])${name}\\s*(=|[},])`));
  return RE_CACHE.get(name);
}

export function hasAttr(el, name) {
  return attrRe(name).test(el.attrs);
}

/** The raw source of one attribute's value, braces and quotes stripped. */
export function attrValue(el, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*`);
  const m = re.exec(el.attrs);
  if (!m) return null;
  const start = m.index + m[0].length;
  const first = el.attrs[start];
  if (first === '{') {
    const end = matchBracket(maskSource(el.attrs).masked, start);
    return end === -1 ? el.attrs.slice(start) : el.attrs.slice(start + 1, end).trim();
  }
  if (first === '"' || first === "'") {
    const end = el.attrs.indexOf(first, start + 1);
    return end === -1 ? el.attrs.slice(start + 1) : el.attrs.slice(start + 1, end);
  }
  const m2 = /^\S+/.exec(el.attrs.slice(start));
  return m2 ? m2[0] : null;
}

const PRESSABLE = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback|Button|RectButton|BorderlessButton|Animated\.(Pressable|View))$/;
const REAL_PRESSABLE = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback|RectButton|BorderlessButton)$/;
const IMAGEISH = /^(Image|ImageBackground|Animated\.Image|ExpoImage|FastImage)$/;
const TEXTISH = /^(Text|Animated\.Text|RNText)$/;
const SCROLLISH = /^(ScrollView|FlatList|SectionList|VirtualizedList|KeyboardAwareScrollView|Animated\.(ScrollView|FlatList)|FlashList)$/;
const ICONISH = /(Icons?|Svg|Ionicons|Feather|Entypo|Octicons|Fontisto|Foundation|Zocial)$/;

export const is = {
  pressable: (el) => REAL_PRESSABLE.test(el.name) || (PRESSABLE.test(el.name) && hasAttr(el, 'onPress')),
  realPressable: (el) => REAL_PRESSABLE.test(el.name),
  image: (el) => IMAGEISH.test(el.name),
  text: (el) => TEXTISH.test(el.name),
  scroll: (el) => SCROLLISH.test(el.name),
  icon: (el) => ICONISH.test(el.name),
  input: (el) => /^(TextInput|Animated\.TextInput)$/.test(el.name),
  modal: (el) => /^Modal$/.test(el.name),
};

/** Does anything under this element render words? */
export function hasTextInside(el) {
  if (descendants(el).some(is.text)) return true;
  const stripped = el.innerSrc.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ');
  return /[A-Za-z]{2,}/.test(stripped);
}

/**
 * Merge everything an element's `style` prop points at into one property map,
 * and say which named styles were involved.
 */
/**
 * Split a style prop into the pieces it is made of. `[a, dark && b, x ? c : d]`
 * comes back as three pieces, each knowing whether it is conditional — because
 * merging a light style with its own dark override produces a colour pair that
 * never actually appears on screen, and a gate that reports those is a gate
 * nobody trusts.
 */
export function styleEntries(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return [{ text: trimmed, conditional: /&&|\?/.test(trimmed) }];
  const masked = maskSource(trimmed).masked;
  const close = matchBracket(masked, 0);
  const inner = trimmed.slice(1, close === -1 ? trimmed.length : close);
  const innerMasked = masked.slice(1, close === -1 ? masked.length : close);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i += 1) {
    const c = innerMasked[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    if ((c === ',' && depth === 0) || i === inner.length) {
      const text = inner.slice(start, i).trim();
      if (text) parts.push({ text, conditional: /&&|\?/.test(text) });
      start = i + 1;
    }
  }
  return parts;
}

export function resolveStyle(el, file, attr = 'style', { baseOnly = false } = {}) {
  const rawAll = attrValue(el, attr);
  if (rawAll == null) return { props: {}, names: [], raw: null, resolvable: false };
  const raw = baseOnly
    ? styleEntries(rawAll).filter((p) => !p.conditional).map((p) => p.text).join(',')
    : rawAll;
  const props = {};
  const names = [];
  let resolvable = false;
  for (const m of raw.matchAll(/styles\.([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
    const entry = file.styles[m[1]];
    if (entry) { resolvable = true; Object.assign(props, entry.props); }
  }
  const masked = maskSource(raw).masked;
  for (let i = 0; i < raw.length; i += 1) {
    if (masked[i] !== '{') continue;
    const { entries } = parseObjectLiteral(raw, masked, i);
    if (entries.length) {
      resolvable = true;
      for (const e of entries) props[e.key] = e.value;
    }
    const close = matchBracket(masked, i);
    i = close === -1 ? raw.length : close;
  }
  return { props, names, raw, resolvable };
}

/** A style property as a number, when it plainly is one. */
export function numProp(props, key) {
  const raw = props[key];
  if (raw === undefined) return null;
  const m = /^-?\d+(\.\d+)?$/.exec(String(raw).trim());
  return m ? Number(m[0]) : null;
}

/** How big is this control, really? Returns null when it cannot be worked out. */
export function touchSize(el, file) {
  const { props, resolvable } = resolveStyle(el, file);
  if (!resolvable) return null;
  const pad = (a, b, c) => {
    const direct = numProp(props, a);
    if (direct !== null) return direct * 2;
    const one = numProp(props, b);
    const two = numProp(props, c);
    if (one !== null || two !== null) return (one ?? 0) + (two ?? 0);
    const all = numProp(props, 'padding');
    return all === null ? null : all * 2;
  };
  const iconSize = (() => {
    const icon = descendants(el).find(is.icon);
    if (!icon) return null;
    const s = attrValue(icon, 'size');
    const n = s === null ? null : Number(s);
    return Number.isFinite(n) ? n : 22;
  })();
  const content = hasTextInside(el) ? 18 : (iconSize ?? 0);

  const height = numProp(props, 'minHeight') ?? numProp(props, 'height')
    ?? ((pad('paddingVertical', 'paddingTop', 'paddingBottom') ?? 0) + content);
  const widthRaw = numProp(props, 'minWidth') ?? numProp(props, 'width');
  const stretches = props.flex === '1'
    || /stretch/.test(String(props.alignSelf ?? ''))
    || /100%/.test(String(props.width ?? ''));
  const padH = pad('paddingHorizontal', 'paddingLeft', 'paddingRight');
  // A row of text with no width set is as wide as its words, and this scanner
  // cannot measure words. Say so with null rather than guessing a small number.
  const width = widthRaw ?? (stretches ? null : (padH === null ? null : padH + content));

  let slop = 0;
  const slopRaw = attrValue(el, 'hitSlop');
  if (slopRaw != null) {
    const n = Number(slopRaw.trim());
    if (Number.isFinite(n)) slop = n * 2;
    else {
      const nums = [...slopRaw.matchAll(/(top|bottom|left|right)\s*:\s*(\d+)/g)].map((m) => Number(m[2]));
      slop = nums.length ? Math.min(...nums) * 2 : 0;
    }
  }
  if (height === 0 && width === null && slop === 0) return null;
  return { height: height + slop, width: width === null ? null : width + slop, hadSlop: slop > 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// The checks
//
// One function per question. Several rules can share a function — Apple wants a
// 44pt target and Google wants 48dp, and that is one piece of arithmetic asked
// twice — so each detector is given the rule it is answering for.
// ─────────────────────────────────────────────────────────────────────────────

const D = {};

const eachEl = (ctx, fn) => {
  for (const f of ctx.files) for (const el of f.elements) fn(el, f);
};
const eachScreen = (ctx, fn) => {
  for (const f of ctx.files) if (f.isScreen) fn(f);
};

// ── Touch targets ────────────────────────────────────────────────────────────

const touchTarget = (minimum) => (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    const size = touchSize(el, f);
    if (!size) return;
    const tooShort = size.height > 0 && size.height < minimum;
    const tooNarrow = size.width !== null && size.width < minimum;
    if (!tooShort && !tooNarrow) return;
    const measured = size.width === null
      ? `${Math.round(size.height)} tall`
      : `${Math.round(size.width)} wide by ${Math.round(size.height)} tall`;
    out(rule, f, el.line, `<${el.name}> is about ${measured} and needs ${minimum}. ${size.hadSlop ? 'Its hitSlop does not make up the difference.' : 'Give it a bigger box, or a hitSlop that does.'}`);
  });
};
D['OGN-IOS-004'] = touchTarget(THRESHOLDS.iosTouchTarget);
D['A11Y-7'] = touchTarget(THRESHOLDS.iosTouchTarget);
D['AND-TOUCH-01'] = touchTarget(THRESHOLDS.androidTouchTarget);

// ── Names for screen readers ─────────────────────────────────────────────────

const iconOnlyPressable = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    if (hasTextInside(el)) return;
    const kids = descendants(el);
    if (!kids.some((k) => is.icon(k) || is.image(k))) return;
    if (hasAttr(el, 'accessibilityLabel') || hasAttr(el, 'aria-label')) return;
    out(rule, f, el.line, `<${el.name}> holds only an icon or a picture, so a screen reader has nothing to say for it.`);
  });
};
D['A11Y-1'] = iconOnlyPressable;
D['AND-A11Y-01'] = iconOnlyPressable;
D['OGN-IOS-020'] = (ctx, rule, out) => {
  iconOnlyPressable(ctx, rule, out);
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    if (hasAttr(el, 'accessibilityRole') || hasAttr(el, 'role')) return;
    out(rule, f, el.line, `<${el.name}> never says it is a button.`);
  });
};

const unlabelledImage = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.image(el)) return;
    if (hasAttr(el, 'accessibilityLabel') || hasAttr(el, 'alt') || hasAttr(el, 'aria-label')) return;
    const hidden = hasAttr(el, 'accessibilityElementsHidden')
      || /importantForAccessibility\s*=\s*["{]?\s*['"]?no/.test(el.attrs)
      || /accessible\s*=\s*\{\s*false\s*\}/.test(el.attrs);
    if (hidden) return;
    out(rule, f, el.line, `<${el.name}> has no description and was not marked decorative.`);
  });
};
D['A11Y-2'] = unlabelledImage;
D['OGN-IOS-007'] = unlabelledImage;

D['A11Y-4'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.input(el)) return;
    if (hasAttr(el, 'accessibilityLabel') || hasAttr(el, 'aria-label')) return;
    out(rule, f, el.line, 'A text field with no label. Its placeholder does not count.');
  });
};

D['A11Y-10'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    if (hasAttr(el, 'accessibilityRole') || hasAttr(el, 'role')) return;
    out(rule, f, el.line, `<${el.name}> never declares a role, so it is announced as plain content.`);
  });
};

const selectedState = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    const raw = attrValue(el, 'style');
    if (!raw) return;
    const looksSelected = /styles\.\w*(Active|Selected|On|Current)\b/.test(raw)
      || /(===|!==)[^,\]]*&&\s*styles\./.test(raw);
    if (!looksSelected) return;
    if (/accessibilityState/.test(el.attrs) || /aria-selected|aria-checked/.test(el.attrs)) return;
    out(rule, f, el.line, `<${el.name}> shows selection with colour only. Nothing tells VoiceOver or TalkBack which one is chosen.`);
  });
};
D['A11Y-3'] = selectedState;
D['OGN-IOS-008'] = selectedState;
D['AND-A11Y-02'] = selectedState;

D['A11Y-8'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (el.name !== 'View' && el.name !== 'Animated.View') return;
    const raw = attrValue(el, 'style');
    if (!raw) return;
    const computed = /(backgroundColor|borderColor)\s*:\s*[^,}]*(\?|\[|status|state|flag|is[A-Z])/.test(raw);
    if (!computed) return;
    if (hasAttr(el, 'accessibilityLabel')) return;
    if (hasTextInside(el)) return;
    const siblingText = el.parent ? descendants(el.parent).some(is.text) : false;
    if (siblingText) return;
    out(rule, f, el.line, 'Colour is the only thing telling these apart. Add a word, a shape, or a label that names the state.');
  });
};

D['A11Y-9'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    const label = attrValue(el, 'accessibilityLabel');
    if (label == null) return;
    if (/[`${]/.test(label)) return;
    const texts = descendants(el).filter(is.text);
    if (texts.length < 2) return;
    out(rule, f, el.line, `The label is fixed text while the button shows ${texts.length} different pieces of writing. Whoever hears it gets less than whoever sees it.`);
  });
};

D['A11Y-12'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    const gestureOnly = (hasAttr(el, 'onPressIn') || hasAttr(el, 'onLongPress')) && !hasAttr(el, 'onPress');
    if (!gestureOnly) return;
    if (hasAttr(el, 'accessibilityActions')) return;
    out(rule, f, el.line, 'This only answers a hold or a swipe. There is no ordinary button doing the same job.');
  });
};

// ── Text that must be allowed to grow ────────────────────────────────────────

const fixedHeightAroundText = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const el of f.elements) {
      if (is.image(el) || is.icon(el) || is.input(el)) continue;
      const { props, resolvable } = resolveStyle(el, f);
      if (!resolvable) continue;
      const h = numProp(props, 'height');
      if (h === null) continue;
      if (!hasTextInside(el)) continue;
      out(rule, f, el.line, `<${el.name}> is locked to ${h} tall and has words inside. Turn that into minHeight so bigger text still fits.`);
    }
  }
};
D['OGN-IOS-006'] = fixedHeightAroundText;
D['AND-A11Y-03'] = (ctx, rule, out) => {
  fixedHeightAroundText(ctx, rule, out);
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/allowFontScaling\s*=\s*\{\s*false\s*\}/g)) {
      out(rule, f, f.lineOf(m.index), 'allowFontScaling={false} takes the phone’s font-size setting away from the reader.');
    }
  }
};

D['A11Y-5'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const [name, entry] of Object.entries(f.styles)) {
      const size = numProp(entry.props, 'fontSize');
      if (size === null || size >= THRESHOLDS.minFontSize) continue;
      const at = f.src.indexOf(`${name}:`);
      out(rule, f, at === -1 ? 1 : f.lineOf(at), `styles.${name} sets fontSize ${size}. Nothing should be under ${THRESHOLDS.minFontSize}.`);
    }
  }
};

D['A11Y-6'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.text(el)) return;
    const n = attrValue(el, 'numberOfLines');
    if (n == null) return;
    if (hasAttr(el, 'adjustsFontSizeToFit')) return;
    const reachable = ancestors(el).some((a) => is.realPressable(a));
    if (reachable) return;
    out(rule, f, el.line, `Text cut off after ${n.trim()} line(s) with no way to read the rest.`);
  });
};

D['A11Y-13'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/allowFontScaling\s*=\s*\{\s*false\s*\}/g)) {
      out(rule, f, f.lineOf(m.index), 'This text is locked out of the phone’s font-size setting.');
    }
  }
};

// ── Nothing clipped ──────────────────────────────────────────────────────────

/** Read a picture's real width and height without decoding it. */
export function imageSize(absPath) {
  let buf;
  try { buf = readFileSync(absPath); } catch { return null; }
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const BRAND_ASSET = /logo|seal|crest|wordmark|brand|icon/i;

const brandArtCropped = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.image(el)) return;
    const fit = attrValue(el, 'resizeMode') ?? attrValue(el, 'contentFit');
    if (!fit || !/cover/.test(fit)) return;
    const source = attrValue(el, 'source') ?? '';
    const req = /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(source);
    const assetPath = req ? req[1] : null;
    const isBrand = assetPath ? BRAND_ASSET.test(assetPath) : false;
    if (isBrand) {
      out(rule, f, el.line, `${assetPath.split('/').pop()} is brand artwork drawn with "cover", which crops it. Use "contain".`);
      return;
    }
    if (!assetPath) return;
    const abs = resolve(dirname(f.abs), assetPath);
    const dims = imageSize(abs);
    if (!dims) return;
    const { props, resolvable } = resolveStyle(el, f);
    if (!resolvable) return;
    const w = numProp(props, 'width');
    const h = numProp(props, 'height');
    if (w === null || h === null || !dims.width || !dims.height) return;
    const boxAspect = w / h;
    const srcAspect = dims.width / dims.height;
    const drift = Math.abs(boxAspect / srcAspect - 1);
    if (drift <= 0.10) return;
    out(rule, f, el.line, `${assetPath.split('/').pop()} is ${dims.width}x${dims.height} drawn into ${w}x${h} with "cover". That throws away ${Math.round(drift * 100)}% of the picture.`);
  });
};
D['OGN-IOS-002'] = brandArtCropped;
D['AND-LAYOUT-02'] = brandArtCropped;
D['ONBOARD-1'] = brandArtCropped;

const columnCannotScroll = (minHeightPt) => (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    if (f.elements.some(is.scroll)) return;
    if (/\bScreen\b/.test(f.masked) && /from\s+['"].*components\/Screen/.test(f.src)) return;
    let tallest = null;
    for (const el of f.elements) {
      const fixed = el.children.filter((c) => {
        const { props, resolvable } = resolveStyle(c, f);
        if (!resolvable) return false;
        return numProp(props, 'height') !== null || numProp(props, 'marginTop') !== null || numProp(props, 'marginBottom') !== null;
      });
      if (fixed.length >= 6 && (!tallest || fixed.length > tallest.count)) tallest = { el, count: fixed.length };
    }
    if (!tallest) return;
    out(rule, f, tallest.el.line, `<${tallest.el.name}> stacks ${tallest.count} fixed-size children and this screen has no scroll view anywhere. On a ${minHeightPt}pt phone the bottom of it cannot be reached.`);
  });
};
D['OGN-IOS-001'] = columnCannotScroll(THRESHOLDS.shortestIosScreen);
D['AND-LAYOUT-01'] = columnCannotScroll(THRESHOLDS.shortestAndroidScreen);
D['ONBOARD-2'] = columnCannotScroll(THRESHOLDS.shortestIosScreen);
D['A11Y-11'] = (ctx, rule, out) => {
  brandArtCropped(ctx, rule, out);
  columnCannotScroll(THRESHOLDS.shortestIosScreen)(ctx, rule, out);
};

const negativeOffsetClipped = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    const { props, resolvable } = resolveStyle(el, f);
    if (!resolvable) return;
    if (!/absolute/.test(String(props.position ?? ''))) return;
    const negative = ['top', 'right', 'bottom', 'left'].filter((k) => {
      const n = numProp(props, k);
      return n !== null && n < 0;
    });
    if (!negative.length) return;
    for (const a of ancestors(el)) {
      const parent = resolveStyle(a, f);
      if (!parent.resolvable) continue;
      const radius = numProp(parent.props, 'borderRadius');
      const clips = /hidden/.test(String(parent.props.overflow ?? '')) || (radius !== null && radius > 0);
      if (clips) {
        out(rule, f, el.line, `<${el.name}> is pushed ${negative.join(' and ')} outside <${a.name}>, which rounds its corners and clips anything outside them.`);
        return;
      }
      if (parent.props.overflow || radius !== null) return;
    }
  });
};
D['OGN-IOS-005'] = negativeOffsetClipped;
D['AND-LAYOUT-03'] = negativeOffsetClipped;

const missingBottomInset = (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    const usesHook = /useSafeAreaInsets\s*\(/.test(f.masked) && /\binsets?\s*(\.|\?\.)\s*bottom/.test(f.masked);
    const safeAreaEls = f.elements.filter((el) => el.name === 'SafeAreaView');
    const safeBottom = safeAreaEls.some((el) => {
      const edges = attrValue(el, 'edges');
      return edges == null || /bottom/.test(edges);
    });
    const viaScreen = /from\s+['"](\.\.?\/)+components\/Screen['"]/.test(f.src);
    if (usesHook || safeBottom || viaScreen) return;
    out(rule, f, 1, 'This screen never reads the bottom inset, so on a phone with a home bar its last row sits underneath it.');
  });
};
D['OGN-IOS-003'] = missingBottomInset;
D['AND-EDGE-02'] = missingBottomInset;

D['AND-EDGE-01'] = (ctx, rule, out) => {
  const f = ctx.byRel['app/(tabs)/_layout.tsx'];
  if (!f) return;
  const block = /tabBarStyle\s*:\s*\{/.exec(f.masked);
  if (!block) return;
  const start = block.index + block[0].length - 1;
  const { entries } = parseObjectLiteral(f.src, f.masked, start);
  for (const e of entries) {
    if (e.key !== 'height' && e.key !== 'paddingBottom') continue;
    if (/insets?\s*\./.test(e.value)) continue;
    out(rule, f, f.lineOf(e.start), `The tab bar sets ${e.key} to ${e.value.replace(/\s+/g, ' ')} instead of reading the phone's own bottom inset.`);
  }
};

D['OGN-IOS-027'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.image(el)) return;
    const { props, resolvable } = resolveStyle(el, f);
    if (!resolvable) return;
    if (props.aspectRatio) return;
    const minH = numProp(props, 'minHeight');
    if (minH === null) return;
    if (numProp(props, 'height') !== null) return;
    out(rule, f, el.line, `<${el.name}> is sized by a minHeight of ${minH} with no aspectRatio, so its shape depends on whatever box it lands in.`);
  });
};

// ── Contrast ─────────────────────────────────────────────────────────────────

function resolveColorToken(raw, themeColors) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const token = /^colors\.([A-Za-z_$][\w$]*)$/.exec(s);
  if (token) return parseColor(themeColors[token[1]]);
  return parseColor(s);
}

D['OGN-IOS-017'] = (ctx, rule, out) => {
  const seen = new Set();
  const report = (f, line, key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    out(rule, f, line, message);
  };
  // Text drawn on the first ancestor that paints a background.
  eachEl(ctx, (el, f) => {
    if (!is.text(el)) return;
    const { props } = resolveStyle(el, f, 'style', { baseOnly: true });
    const fg = resolveColorToken(props.color, ctx.themeColors);
    if (!fg) return;
    let bg = null;
    for (const a of ancestors(el)) {
      const p = resolveStyle(a, f, 'style', { baseOnly: true }).props;
      const candidate = resolveColorToken(p.backgroundColor, ctx.themeColors);
      if (candidate && candidate.a >= 1) { bg = candidate; break; }
    }
    if (!bg) return;
    const flat = fg.a < 1 ? flatten(fg, bg) : fg;
    const size = numProp(props, 'fontSize') ?? 15;
    const weight = String(props.fontWeight ?? '').replace(/['"]/g, '');
    const large = size >= 18 || (size >= 14 && (weight === 'bold' || Number(weight) >= 700));
    const need = large ? THRESHOLDS.contrastLarge : THRESHOLDS.contrastNormal;
    const ratio = contrastRatio(flat, bg);
    if (ratio >= need) return;
    report(f, el.line, `${f.rel}:${el.line}`, `Text at ${ratio.toFixed(2)}:1 against what is behind it. ${size}pt text needs ${need}:1.`);
  });
  // Placeholder text inside its own field.
  eachEl(ctx, (el, f) => {
    if (!is.input(el)) return;
    const ph = resolveColorToken(attrValue(el, 'placeholderTextColor'), ctx.themeColors);
    if (!ph) return;
    const { props } = resolveStyle(el, f);
    const bg = resolveColorToken(props.backgroundColor, ctx.themeColors);
    if (!bg) return;
    const ratio = contrastRatio(ph.a < 1 ? flatten(ph, bg) : ph, bg);
    if (ratio >= THRESHOLDS.contrastNormal) return;
    report(f, el.line, `ph:${f.rel}:${el.line}`, `The hint inside this field is at ${ratio.toFixed(2)}:1 against the field. It needs ${THRESHOLDS.contrastNormal}:1.`);
  });
  // The tab bar's own tints.
  const tabs = ctx.byRel['app/(tabs)/_layout.tsx'];
  if (tabs) {
    const grab = (key) => { const m = new RegExp(`${key}\\s*:\\s*([^,\\n]+)`).exec(tabs.masked); return m ? tabs.src.slice(m.index + m[0].indexOf(m[1]), m.index + m[0].length).trim() : null; };
    const bgRaw = /backgroundColor\s*:\s*([^,\n]+)/.exec(tabs.src.slice(tabs.src.indexOf('tabBarStyle')));
    const active = resolveColorToken(grab('tabBarActiveTintColor'), ctx.themeColors);
    const bg = bgRaw ? resolveColorToken(bgRaw[1].replace(/.*:\s*/, '').trim(), ctx.themeColors) : null;
    if (active && bg) {
      const ratio = contrastRatio(active, bg);
      if (ratio < THRESHOLDS.contrastLarge) {
        report(tabs, tabs.lineOf(tabs.src.indexOf('tabBarActiveTintColor')), 'tabbar', `The selected tab is at ${ratio.toFixed(2)}:1 against the tab bar, which makes the chosen tab the hardest of the six to read.`);
      }
    }
  }
};

// ── Nothing fake, nothing unfinished ─────────────────────────────────────────

/**
 * Everything a person could actually read on screen: quoted copy, and the words
 * written straight between <Text> tags. Both are copy; only one of them is a
 * string literal, and a scanner that looked only at literals would miss half the
 * writing in this app.
 */
function userFacingStrings(f, { skipRanges = [] } = {}) {
  const out = [];
  for (const s of f.strings) {
    if (s.quote === '`') continue;
    if (skipRanges.some((r) => s.start >= r.start && s.start <= r.end)) continue;
    const text = s.text;
    if (!/[A-Za-z]{3,}/.test(text)) continue;
    if (/^[\w./@-]+$/.test(text)) continue;           // a path, an id, a key name
    // A string being compared against is a needle, not copy. lib/errorMessages.ts
    // is full of database phrases it matches on precisely so the member never
    // sees one, and reporting those would punish the file for doing the right thing.
    const lead = f.masked.slice(Math.max(0, s.start - 40), s.start);
    if (/\.(includes|startsWith|endsWith|indexOf|match|search|test|split|replace)\(\s*$/.test(lead)) continue;
    if (/[=!]==?\s*$/.test(lead)) continue;
    out.push({ text, line: f.lineOf(s.start), start: s.start });
  }
  for (const el of f.elements) {
    if (!is.text(el)) continue;
    const written = el.innerSrc
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!/[A-Za-z]{3,}\s+[A-Za-z]/.test(written)) continue;   // one word is a label, not copy
    if (skipRanges.some((r) => el.start >= r.start && el.start <= r.end)) continue;
    out.push({ text: written, line: el.line, start: el.start });
  }
  return out;
}

function alertArgs(f) {
  const out = [];
  for (const m of f.masked.matchAll(/Alert\.alert\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(f.masked, open);
    if (close === -1) continue;
    out.push({ raw: f.src.slice(open + 1, close), line: f.lineOf(m.index), start: m.index });
  }
  return out;
}

const DEV_WORDS = /\b(supabase|postgrest|postgres|rls|expo_public_[a-z_]*|env(?:ironment)? variable|api[- ]key|bucket|endpoint|localhost|127\.0\.0\.1|null|undefined|json|http \d{3}|status code|stack trace|exception|sql|uuid|token|payload|backend|admin console|dashboard settings|app storage setup)\b/i;
const FAKE_NAMES = /\b(john (doe|overcomer)|jane doe|lorem ipsum|foo ?bar|test user|example\.com)\b/i;
const PLACEHOLDER_ASSET = /(placeholder|sample|demo|mock|dummy|\/ref\/)/i;
const INVENTED_STAT = /^\s*\d[\d.,]*\s*[KMB]?\+\s*$/;
// An honest empty state ("New messages will appear here") is good copy, not a
// promise the build cannot keep. Only the ones that describe a feature that does
// not exist belong here.
const UNDELIVERABLE = /(coming soon|not available yet|will be available here|once .{0,40} is (ready|complete)|after .{0,40} review is complete|in a future (update|version))/i;

D['NO-DEV-LANGUAGE'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const a of alertArgs(f)) {
      const words = [...a.raw.matchAll(/['"]([^'"]{6,})['"]/g)].map((m) => m[1]);
      for (const w of words) {
        const hit = DEV_WORDS.exec(w);
        if (!hit) continue;
        out(rule, f, a.line, `A pop-up says "${w.slice(0, 70)}${w.length > 70 ? '…' : ''}" — that names ${hit[0]}, which means nothing to a member.`);
        break;
      }
    }
    const alertRanges = alertArgs(f).map((a) => ({ start: a.start, end: a.start + a.raw.length + 14 }));
    for (const s of userFacingStrings(f, { skipRanges: alertRanges })) {
      if (s.text.length < 18) continue;
      const hit = DEV_WORDS.exec(s.text);
      if (!hit) continue;
      if (/^import |require\(/.test(s.text)) continue;
      out(rule, f, s.line, `Copy on screen names ${hit[0]}: "${s.text.slice(0, 70)}${s.text.length > 70 ? '…' : ''}"`);
    }
  }
};

D['OGN-IOS-013'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!PLACEHOLDER_ASSET.test(m[1])) continue;
      out(rule, f, f.lineOf(m.index), `A picture called ${m[1].split('/').pop()} is being shown to people.`);
    }
    for (const s of f.strings) {
      if (s.quote === '`') continue;
      if (INVENTED_STAT.test(s.text) && s.text.trim().length > 1) {
        out(rule, f, f.lineOf(s.start), `The number "${s.text.trim()}" is typed into the code and shown as if it were counted.`);
      }
      if (FAKE_NAMES.test(s.text)) {
        out(rule, f, f.lineOf(s.start), `An invented name or address appears in the app: "${s.text.slice(0, 50)}".`);
      }
    }
    for (const s of userFacingStrings(f)) {
      if (UNDELIVERABLE.test(s.text)) {
        out(rule, f, s.line, `Copy promises something later: "${s.text.slice(0, 70)}"`);
        continue;
      }
      const stand_in = /\b(lorem ipsum|sample (text|content|story|data)|demo (mode|content|data|story)|dummy (text|data)|placeholder|test data|fake )\b/i.exec(s.text);
      if (!stand_in) continue;
      out(rule, f, s.line, `Stand-in copy is on screen ("${stand_in[0].trim()}"): "${s.text.slice(0, 70)}"`);
    }
  }
};

const unconditionalLive = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.text(el)) return;
    const inner = el.innerSrc.trim();
    if (!/^(live|live now|on air|streaming now)$/i.test(inner)) return;
    const guarded = ancestors(el).slice(0, 3).some((a) => /\?|&&/.test(a.attrs)) || /\{/.test(el.innerSrc);
    if (guarded) return;
    out(rule, f, el.line, `"${inner}" is always on screen whether or not anything is actually streaming.`);
  });
};

D['NO-UNVERIFIED-CLAIMS'] = (ctx, rule, out) => {
  unconditionalLive(ctx, rule, out);
  for (const f of ctx.files) {
    for (const s of f.strings) {
      if (s.quote === '`') continue;
      if (!INVENTED_STAT.test(s.text)) continue;
      if (s.text.trim().length < 2) continue;
      out(rule, f, f.lineOf(s.start), `"${s.text.trim()}" is presented to people as a fact and comes from nowhere.`);
    }
  }
};
D['AND-PLAY-03'] = (ctx, rule, out) => {
  unconditionalLive(ctx, rule, out);
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/\b(fallback|mock|demo|sample|placeholder)[A-Z]\w*/g)) {
      const name = f.src.slice(m.index, m.index + m[0].length);
      const after = f.src.slice(m.index + m[0].length, m.index + m[0].length + 30);
      if (!/^\s*[.[]/.test(after)) continue;
      out(rule, f, f.lineOf(m.index), `${name} is read at render time, so invented records can reach the screen as ordinary content.`);
    }
  }
};

D['NO-MOCK-FALLBACK'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.src.matchAll(/from\s+['"]([^'"]*mockData[^'"]*)['"]/g)) {
      out(rule, f, f.lineOf(m.index), `This file imports ${m[1]}. A failed query must show an honest error, never invented content.`);
    }
  }
};

D['NO-FABRICATED-STORY-COPY'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/\|\|\s*fallback\w*\s*[.[]/g)) {
      out(rule, f, f.lineOf(m.index), 'A missing field is quietly filled in from a fallback, so a member’s story shows words they never wrote.');
    }
    for (const m of f.masked.matchAll(/:\s*fallback\w*(\s*\[|\s*;|\s*\))/g)) {
      out(rule, f, f.lineOf(m.index), 'When the real list is empty this substitutes invented records instead of an empty state.');
    }
  }
};

D['GATE-NO-DEV-MARKERS'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const c of f.comments) {
      const hit = /\b(TODO|FIXME|HACK|XXX)\b/.exec(c.text);
      if (!hit) continue;
      out(rule, f, f.lineOf(c.start), `A ${hit[1]} is still in the code: ${c.text.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
    }
  }
};

const deadControls = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (is.realPressable(el)) {
      const handler = attrValue(el, 'onPress');
      if (handler && /^\(\s*\)\s*=>\s*Alert\.alert\(/.test(handler.trim()) && !/router|set[A-Z]|await|navigate/.test(handler)) {
        out(rule, f, el.line, `<${el.name}> only opens a pop-up explaining that the thing does not exist yet.`);
      }
      return;
    }
    if (is.text(el) && /^(view|see) all$/i.test(el.innerSrc.trim())) {
      if (!ancestors(el).some(is.realPressable)) {
        out(rule, f, el.line, '"View all" is written on screen but nothing happens when it is pressed.');
      }
    }
  });
  // A play glyph that is not inside anything pressable.
  eachEl(ctx, (el, f) => {
    const { names } = resolveStyle(el, f);
    if (!names.some((n) => /play|chevron|arrow/i.test(n))) return;
    if (ancestors(el).some(is.realPressable) || is.realPressable(el)) return;
    out(rule, f, el.line, `<${el.name}> is drawn as a play or arrow control and nothing responds to a press.`);
  });
};
D['NO-DEAD-CONTROLS'] = deadControls;
D['OGN-IOS-014'] = deadControls;

D['NO-UNDELIVERABLE-PROMISES'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const s of userFacingStrings(f)) {
      if (!UNDELIVERABLE.test(s.text) && !/\bfrom Admin\b/i.test(s.text)) continue;
      out(rule, f, s.line, `"${s.text.slice(0, 80)}" describes something the build does not do yet.`);
    }
  }
};

D['NO-DEAD-CODE'] = (ctx, rule, out) => {
  const importedBy = new Map();
  for (const f of ctx.files) {
    for (const m of f.src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(f.abs), spec);
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const p = target + ext;
        if (existsSync(p)) { importedBy.set(p, (importedBy.get(p) ?? 0) + 1); break; }
      }
    }
  }
  for (const f of ctx.files) {
    if (f.isRoute) continue;                     // expo-router reaches routes by filename
    if (/\.test\./.test(f.rel)) continue;
    if (importedBy.get(f.abs)) continue;
    out(rule, f, 1, 'Nothing imports this file, so whatever is in it can never run — and it still ships.');
  }
};

// ── Fast, or honestly showing its work ───────────────────────────────────────

D['NO-SILENT-FAILURE'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(f.masked, open);
      if (close === -1) continue;
      const body = f.masked.slice(open + 1, close).trim();
      const realBody = f.src.slice(open + 1, close);
      if (body === '') {
        out(rule, f, f.lineOf(m.index), 'An empty catch. Something failed and the person was told nothing.');
        continue;
      }
      const onlyLogs = /^[\s;]*console\.(log|warn|error|info)\s*\([\s\S]*?\)\s*;?[\s;]*$/.test(realBody);
      if (onlyLogs) {
        out(rule, f, f.lineOf(m.index), 'This catch only writes to the developer console. On a phone nobody sees that.');
      }
    }
    for (const m of f.masked.matchAll(/\.then\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(f.masked, open);
      if (close === -1) continue;
      let tail = f.masked.slice(close + 1, close + 200);
      if (/^\s*\.catch/.test(tail) || /^\s*\.finally\s*\([^)]*\)\s*\.catch/.test(tail)) continue;
      const before = f.masked.slice(Math.max(0, m.index - 400), m.index);
      if (/\btry\s*\{[^}]*$/.test(before)) continue;
      if (/await\s+[\w.]*$/.test(before.trim())) continue;
      out(rule, f, f.lineOf(m.index), 'This fills the screen from a promise with no .catch, so a failed load leaves an empty screen and no explanation.');
    }
  }
};

const uploadProgress = (ctx, rule, out) => {
  const svc = ctx.byRel['lib/uploadService.ts'];
  if (svc && !/onProgress|progress\s*[:?)]/i.test(svc.masked)) {
    out(rule, svc, 1, 'The upload service takes no progress callback at all, so no screen above it can show a moving bar.');
  }
  const body = ctx.byRel['lib/uploadBody.ts'];
  if (body && /arrayBuffer\s*\(/.test(body.masked)) {
    const m = /arrayBuffer\s*\(/.exec(body.masked);
    out(rule, body, body.lineOf(m.index), 'The whole file is read into memory before anything is sent. That is the silent five-minute wait, and it cannot report progress.');
  }
  for (const f of ctx.files) {
    // Only screens can render a bar. A service file under lib/ has no UI, and
    // flagging it says "add a progress bar" to a file that cannot have one.
    // Found 2026-09-18: this fired on lib/uploadService.ts line 427, which is
    // the DECLARATION of uploadPickedAsset — the very function that carries
    // the onProgress callback. A declaration is not a call site.
    if (!/\.tsx$/.test(f.rel)) continue;
    for (const m of f.masked.matchAll(/\b(uploadPickedAsset|uploadDocumentAsset|uploadAsset)\s*\(/g)) {
      const before = f.masked.slice(Math.max(0, m.index - 40), m.index);
      if (/\b(function|const|let|var)\s+$|\bexport\s+(async\s+)?function\s+$/.test(before)) continue;
      if (/ActivityIndicator|ProgressBar|progressAnim|<Progress/.test(f.masked)) continue;
      out(rule, f, f.lineOf(m.index), 'An upload starts here and this file never renders a spinner or a progress bar.');
      break;
    }
  }
};
D['UPLOAD-PROGRESS'] = uploadProgress;
D['OGN-IOS-015'] = (ctx, rule, out) => {
  uploadProgress(ctx, rule, out);
  eachEl(ctx, (el, f) => {
    if (!is.realPressable(el)) return;
    const handler = attrValue(el, 'onPress') ?? '';
    if (!/upload|publish|post[A-Z(]|submit|send/i.test(handler)) return;
    if (hasAttr(el, 'disabled')) return;
    out(rule, f, el.line, `<${el.name}> starts a slow action and stays pressable while it runs, so it can be fired twice.`);
  });
};

const uploadLimits = (ctx, rule, out) => {
  const body = ctx.byRel['lib/uploadBody.ts'];
  let maxBytes = null;
  if (body) {
    const m = /maxBytes\s*=\s*([0-9*\s]+)/.exec(body.masked);
    if (m) {
      const expr = body.src.slice(m.index + m[0].indexOf(m[1]), m.index + m[0].length);
      try { maxBytes = Function(`"use strict";return (${expr})`)(); } catch { maxBytes = null; }
    }
  }
  const compresses = ctx.files.some((f) => /expo-image-manipulator|react-native-compressor|ffmpeg|VideoManipulator/.test(f.src));
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/videoMaxDuration\s*:\s*(\d+)/g)) {
      const seconds = Number(f.src.slice(m.index, m.index + m[0].length).split(':')[1]);
      if (maxBytes === null) continue;
      const mb = Math.round(maxBytes / (1024 * 1024));
      if (!compresses && mb < 200) {
        out(rule, f, f.lineOf(m.index), `The picker allows ${seconds} seconds of video and the upload refuses anything over ${mb} MB, with nothing shrinking the file in between. A normal one-minute phone video lands between the two.`);
      }
    }
  }
  if (body && maxBytes !== null && maxBytes <= 50 * 1024 * 1024 && !compresses) {
    const m = /maxBytes/.exec(body.masked);
    out(rule, body, body.lineOf(m.index), `The hard cap is ${Math.round(maxBytes / (1024 * 1024))} MB and nothing compresses before it. Raise the cap and the bucket, or shrink the file first.`);
  }
};
D['UPLOAD-LIMITS-AGREE'] = uploadLimits;
D['OGN-IOS-016'] = uploadLimits;

const refreshOnFocus = (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    if (!/\bget[A-Z]\w*\s*\(/.test(f.masked)) return;
    // Only screens that actually show a list of things people can change.
    if (!/\.map\s*\(|FlatList|SectionList/.test(f.masked)) return;
    const focus = /useFocusEffect|addListener\(\s*['"]focus|useIsFocused|navigation\.addListener/.test(f.masked);
    const pull = /refreshControl|RefreshControl|onRefresh/.test(f.masked);
    if (focus && pull) return;
    const missing = [!focus && 'never reloads when you come back to it', !pull && 'has no pull-to-refresh'].filter(Boolean);
    out(rule, f, 1, `This screen ${missing.join(' and ')}. Whatever was just posted will not appear.`);
  });
};
D['REFRESH-ON-FOCUS'] = refreshOnFocus;

D['OGN-IOS-026'] = (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    if (!/\bget[A-Z]\w*\s*\(|supabase\.from\(/.test(f.masked)) return;
    const loading = /ActivityIndicator|isLoading|loading|Skeleton/.test(f.masked);
    const error = /(set)?[Ee]rror|Try again|retry/.test(f.masked);
    const empty = /empty|nothing (yet|here)|No .* yet/i.test(f.src);
    const missing = [!loading && 'a loading state', !error && 'an error state with a retry', !empty && 'an empty state'].filter(Boolean);
    if (!missing.length) return;
    out(rule, f, 1, `This screen fetches on open but has no ${missing.join(', no ')}. A blank area is all a person gets.`);
  });
};

D['GATE-NET-TIMEOUT'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    if (f.rel === 'lib/requestTimeout.ts') continue;
    for (const m of f.masked.matchAll(/(^|[^.\w])fetch\s*\(/g)) {
      const at = m.index + m[0].length - 1;
      const close = matchBracket(f.masked, at);
      const args = close === -1 ? '' : f.masked.slice(at, close);
      if (/signal\s*:/.test(args)) continue;
      const before = f.masked.slice(Math.max(0, m.index - 600), m.index);
      if (/fetchWithTimeout|AbortController|AbortSignal\.timeout/.test(before)) continue;
      out(rule, f, f.lineOf(m.index), 'A network call with no time limit. On a weak signal it never fails and never finishes — it just hangs, and so does the spinner above it.');
    }
  }
};

// ── Dark and light, everywhere ───────────────────────────────────────────────

const themeEveryScreen = (ctx, rule, out) => {
  const pinned = ctx.appJson?.expo?.userInterfaceStyle;
  if (pinned && pinned !== 'automatic') {
    out(rule, ctx.appJsonFile, ctx.appJsonLine('userInterfaceStyle'), `app.json pins the whole app to "${pinned}", so keyboards, alerts and system surfaces stay ${pinned} even when the member has chosen the other theme.`);
  }
  for (const f of ctx.files) {
    if (!f.isScreen && !f.isComponent) continue;
    if (!f.elements.length) continue;
    const readsTheme = /useThemePreference|useColorScheme|themePreference|\bdark\b\s*[?&|=)]|isDark/.test(f.masked);
    if (readsTheme) continue;
    out(rule, f, 1, 'Nothing here reads which theme the member chose, so this renders the same in dark mode as in light.');
  }
};
D['THEME-EVERY-SCREEN'] = themeEveryScreen;
D['OGN-IOS-018'] = themeEveryScreen;
D['AND-DARK-01'] = themeEveryScreen;
D['OGN-IOS-019'] = (ctx, rule, out) => {
  const pinned = ctx.appJson?.expo?.userInterfaceStyle;
  if (pinned && pinned !== 'automatic') {
    out(rule, ctx.appJsonFile, ctx.appJsonLine('userInterfaceStyle'), `userInterfaceStyle is "${pinned}" while the app ships its own dark theme. It should be "automatic".`);
  }
};

D['GATE-COLOR-LITERALS'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    if (f.rel === 'lib/theme.ts') continue;
    // Colours live inside string literals, which the masked copy blanks out, so
    // this one reads the real source with only the comments removed.
    const withoutComments = f.comments.reduce((acc, c) => acc.slice(0, c.start) + ' '.repeat(c.end - c.start) + acc.slice(c.end), f.src);
    const hits = [...withoutComments.matchAll(COLOR_LITERAL)];
    if (hits.length <= ctx.opts.colorMax) continue;
    out(rule, f, f.lineOf(hits[0].index), `${hits.length} colours are typed into this file (the agreed limit is ${ctx.opts.colorMax}). Each one is a colour the dark theme cannot repaint.`);
  }
};

D['AND-THEME-01'] = (ctx, rule, out) => {
  const bars = new Set();
  for (const f of ctx.files) {
    if (/from\s+['"]expo-status-bar['"]/.test(f.src)) bars.add('expo-status-bar');
    if (/StatusBar[^A-Za-z][^\n]*from\s+['"]react-native['"]/.test(f.src) || /\bStatusBar\b/.test(f.masked) && /from\s+['"]react-native['"]/.test(f.src)) bars.add('react-native StatusBar');
  }
  if (bars.size > 1) {
    out(rule, ctx.files[0], 1, `Two different status-bar implementations are in use (${[...bars].join(' and ')}). They fight each other, and which one wins depends on render order.`);
  }
  const hasNavBar = ctx.packageJson && JSON.stringify(ctx.packageJson.dependencies ?? {}).includes('expo-navigation-bar');
  if (!hasNavBar) {
    out(rule, ctx.appJsonFile, 1, 'Nothing styles the Android navigation bar, so in dark theme its buttons stay whatever the phone last decided.');
  }
};

// ── The owner's own list ─────────────────────────────────────────────────────

D['OGN-IOS-021'] = (ctx, rule, out) => {
  const admin = ctx.byRel['app/admin.tsx'];
  if (!admin) return;
  for (const m of admin.masked.matchAll(/if\s*\(\s*!\s*(\w*[Tt]itle\w*)(\.trim\(\))?\s*\)/g)) {
    out(rule, admin, admin.lineOf(m.index), 'The story form refuses to submit without a title. The owner said the title is optional.');
  }
  for (const m of admin.masked.matchAll(/\b(\w*[Tt]itle\w*)\.trim\(\)\s*(===|==)\s*['"]{2}/g)) {
    out(rule, admin, admin.lineOf(m.index), 'An empty title is treated as a mistake here. It is allowed.');
  }
};

const memberCanPost = (ctx, rule, out) => {
  const home = ctx.byRel['app/(tabs)/index.tsx'];
  if (home) {
    const compose = home.elements.some((el) => {
      if (!is.realPressable(el)) return false;
      const handler = (attrValue(el, 'onPress') ?? '') + (attrValue(el, 'accessibilityLabel') ?? '');
      return /story|compose|post|add/i.test(handler) && !/manage|admin/i.test(handler);
    });
    if (!compose) {
      out(rule, home, 1, 'There is no plus button on Home that lets a member post their own story. Today only Admin can post one.');
    }
    for (const m of home.masked.matchAll(/canManageContent|isStaff|is_admin/g)) {
      const around = home.src.slice(Math.max(0, m.index - 200), m.index + 200);
      if (!/stor/i.test(around)) continue;
      out(rule, home, home.lineOf(m.index), 'The only story action on Home is locked behind a staff check.');
      break;
    }
  }
  const chat = ctx.byRel['app/(tabs)/community.tsx'];
  if (chat) {
    const creates = /createChannel|createChatRoom|createRoom|newConversation|startConversation|insert\(\s*\{[^}]*name/i.test(chat.masked);
    if (!creates) {
      out(rule, chat, 1, 'Nothing in the Chat tab starts a new conversation. A member cannot begin one at all.');
    }
  }
};
D['OGN-IOS-022'] = memberCanPost;
D['MEMBER-STORY-POST'] = (ctx, rule, out) => {
  memberCanPost(ctx, rule, out);
  D['OGN-IOS-021'](ctx, rule, out);
};

const storyViewerQueue = (ctx, rule, out) => {
  const v = ctx.byRel['app/story-viewer.tsx'];
  if (!v) return;
  const takesList = /stories\s*[:=]|items\s*[:=]\s*\[|JSON\.parse\(.*stories|index\s*[:=]/i.test(v.masked);
  if (!takesList) {
    out(rule, v, 1, 'The viewer is handed the fields of exactly one story, so there is no next story for it to go to.');
  }
  const tapAdvance = v.elements.some((el) => is.realPressable(el) && /next|advance|index\s*\+/i.test(attrValue(el, 'onPress') ?? ''));
  if (!tapAdvance) {
    out(rule, v, 1, 'Tapping the picture does not move to the next story. The owner pressed it and nothing happened.');
  }
  if (/finished\s*\)\s*\{?\s*close\(/.test(v.masked)) {
    const m = /finished\s*\)\s*\{?\s*close\(/.exec(v.masked);
    out(rule, v, v.lineOf(m.index), 'When the timer runs out the viewer closes instead of moving on to the next story.');
  }
};
D['STORY-VIEWER-QUEUE'] = storyViewerQueue;
D['OGN-IOS-023'] = storyViewerQueue;
D['AND-NAV-01'] = storyViewerQueue;

D['STORY-MULTISELECT'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/launchImageLibraryAsync\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(f.masked, open);
      const args = close === -1 ? '' : f.src.slice(open, close);
      const around = f.src.slice(Math.max(0, m.index - 400), m.index + 400);
      if (!/stor(y|ies)/i.test(around)) continue;
      if (/allowsMultipleSelection\s*:\s*true/.test(args)) continue;
      out(rule, f, f.lineOf(m.index), 'The story picker takes one photo only. Two photos in one story is not possible.');
    }
  }
};

D['CHAT-PHOTO-ASPECT'] = (ctx, rule, out) => {
  const f = ctx.byRel['components/ChatAttachments.tsx'];
  if (!f) return;
  for (const [name, entry] of Object.entries(f.styles)) {
    if (!/image|photo|bubble/i.test(name)) continue;
    if (entry.props.aspectRatio && /^1$|^1\.0$/.test(String(entry.props.aspectRatio).trim())) {
      const at = f.src.indexOf(`${name}:`);
      out(rule, f, at === -1 ? 1 : f.lineOf(at), `styles.${name} forces a square. A photo sent from a phone is not square, so it arrives cropped.`);
    }
  }
  for (const el of f.elements) {
    if (!is.image(el)) continue;
    const fit = attrValue(el, 'contentFit') ?? attrValue(el, 'resizeMode');
    if (fit && /cover/.test(fit) && /Bubble|message/i.test(f.src.slice(Math.max(0, el.start - 600), el.start))) {
      out(rule, f, el.line, 'The photo in the bubble is drawn with "cover", which crops it to fit the box instead of keeping the shape that was chosen.');
    }
  }
};

const mapControls = (ctx, rule, out) => {
  const f = ctx.byRel['app/maps.native.tsx'] ?? ctx.byRel['app/maps.tsx'];
  if (!f) return;
  for (const el of f.elements) {
    if (!is.realPressable(el)) continue;
    const label = (attrValue(el, 'accessibilityLabel') ?? '') + ' ' + el.innerSrc;
    if (!/my location|locate|current location/i.test(label + (attrValue(el, 'onPress') ?? ''))) continue;
    const { names } = resolveStyle(el, f);
    if (names.some((n) => /topBar|header|top/i.test(n))) {
      out(rule, f, el.line, 'My-location sits in the top bar. The owner wants it in the bottom-right, under the zoom buttons where his thumb already is.');
    }
  }
  if (!/requestForegroundPermissionsAsync/.test(f.masked)) {
    out(rule, f, 1, 'The map never asks for location, so it cannot open where the person actually is.');
  }
  if (!/satellite|raster|imagery/i.test(f.masked)) {
    out(rule, f, 1, 'There is no satellite view to switch to.');
  }
};
D['MAP-CONTROLS'] = mapControls;
D['OGN-IOS-024'] = mapControls;

const mediaCovers = (ctx, rule, out) => {
  const embed = ctx.byRel['lib/embed.ts'];
  if (embed && !/thumbnail|poster|preview/i.test(embed.masked)) {
    out(rule, embed, 1, 'Nothing here works out a YouTube thumbnail, so a pasted link arrives with no cover picture.');
  }
  if (embed && !/title/i.test(embed.masked)) {
    out(rule, embed, 1, 'Nothing here fetches the video title, so the admin has to type it by hand.');
  }
  const mgmt = ctx.byRel['lib/adminManagementService.ts'];
  if (mgmt && /updateMediaRecord/.test(mgmt.masked) && !/thumbnailUrl|thumbnail_url/.test(mgmt.masked)) {
    const m = /updateMediaRecord/.exec(mgmt.masked);
    out(rule, mgmt, mgmt.lineOf(m.index), 'An admin can change the title and the speaker but not the cover picture.');
  }
};
D['MEDIA-COVER-EDITABLE'] = mediaCovers;
D['OGN-IOS-025'] = mediaCovers;

D['PRAYER-VISIBILITY'] = (ctx, rule, out) => {
  const p = ctx.byRel['app/prayer.tsx'];
  const svc = ctx.byRel['lib/contentService.ts'];
  if (p && /useState\s*(<[^>]*>)?\s*\(\s*true\s*\)/.test(p.masked) && /isPrivate/.test(p.masked)) {
    const m = /isPrivate/.exec(p.masked);
    out(rule, p, p.lineOf(m.index), 'New requests default to private while the list underneath only shows public ones, so what you just sent is never in the list you are looking at.');
  }
  if (svc && /\.eq\(\s*['"]is_private['"]\s*,\s*false\s*\)/.test(svc.masked)) {
    const m = /\.eq\(\s*['"]is_private['"]/.exec(svc.masked);
    out(rule, svc, svc.lineOf(m.index), 'The shared list hides every private request, which is where the default sends them.');
  }
};

D['CONFIG-NOT-HARDCODED'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    if (f.rel === 'lib/publicEnv.ts') continue;
    for (const s of f.strings) {
      if (!/^https?:\/\//.test(s.text)) continue;
      if (!/donate|give|giving|stripe|stream|live|youtube\.com\/live/i.test(s.text)) continue;
      out(rule, f, f.lineOf(s.start), 'A giving or live-stream address is typed into a screen. Move it to EXPO_PUBLIC_GIVING_URL / EXPO_PUBLIC_LIVE_STREAM_URL so it can be changed without a new build.');
    }
  }
};

// ── Android behaviour ────────────────────────────────────────────────────────

D['AND-BACK-01'] = (ctx, rule, out) => {
  eachScreen(ctx, (f) => {
    const inAppBack = /set(Screen|Step|Mode|Page|View)\s*\(|setScreen\(|goBackInternal/.test(f.masked);
    if (!inAppBack) return;
    if (/BackHandler/.test(f.masked)) return;
    out(rule, f, 1, 'This screen has its own back that changes what is on screen, but the Android back gesture still leaves the screen entirely. The two must agree.');
  });
};

D['AND-BACK-02'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.modal(el)) return;
    if (hasAttr(el, 'onRequestClose')) return;
    out(rule, f, el.line, 'A pop-up the Android back button cannot close.');
  });
};

const keyboardOnAndroid = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (el.name !== 'KeyboardAvoidingView') return;
    const behavior = attrValue(el, 'behavior') ?? '';
    if (/Platform\.OS[^?]*\?\s*['"]padding['"]\s*:\s*['"](height|padding)['"]/.test(behavior)) return;
    if (/['"](height|padding)['"]/.test(behavior) && !/undefined/.test(behavior)) return;
    out(rule, f, el.line, 'On Android this does nothing — the behaviour it is given is undefined there, so the keyboard covers the field.');
  });
  const mode = ctx.appJson?.expo?.android?.softwareKeyboardLayoutMode;
  if (!mode) {
    out(rule, ctx.appJsonFile, 1, 'app.json never pins softwareKeyboardLayoutMode, so how the keyboard pushes the screen is left to a default that changes between Expo versions.');
  }
};
D['AND-KEYBOARD-01'] = keyboardOnAndroid;

D['AND-KEYBOARD-02'] = (ctx, rule, out) => {
  eachEl(ctx, (el, f) => {
    if (!is.modal(el)) return;
    const inside = descendants(el);
    if (!inside.some(is.input)) return;
    if (inside.some((k) => k.name === 'KeyboardAvoidingView' || is.scroll(k))) return;
    out(rule, f, el.line, 'A pop-up with a field in it and nothing lifting it, so on Android the keyboard covers what is being typed.');
  });
};

D['AND-PERM-01'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/requestPermissionsAsync|requestNotificationPermission|getExpoPushTokenAsync/g)) {
      const before = f.masked.slice(Math.max(0, m.index - 600), m.index);
      const inEffect = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*$/.test(before) || /useEffect\([\s\S]{0,300}$/.test(before);
      if (!inEffect) continue;
      if (/onPress|Alert\.alert|rationale|explain/i.test(before)) continue;
      out(rule, f, f.lineOf(m.index), 'The notification permission is asked for as the screen opens, before the person has been told why. Google wants that to follow a tap they chose to make.');
    }
  }
};

const ANDROID_DANGEROUS = {
  'android.permission.ACCESS_FINE_LOCATION': /expo-location|getCurrentPositionAsync|requestForegroundPermissions/,
  'android.permission.ACCESS_COARSE_LOCATION': /expo-location|getCurrentPositionAsync|requestForegroundPermissions/,
  'android.permission.POST_NOTIFICATIONS': /expo-notifications|getExpoPushTokenAsync|scheduleNotification/,
  'android.permission.RECORD_AUDIO': /AudioRecorder|useAudioRecorder|startRecording|launchCameraAsync/,
  'android.permission.CAMERA': /launchCameraAsync|expo-camera|requestCameraPermissions/,
  'android.permission.READ_MEDIA_IMAGES': /MediaLibrary|expo-media-library/,
  'android.permission.READ_MEDIA_VIDEO': /MediaLibrary|expo-media-library/,
};

D['AND-PERM-03'] = (ctx, rule, out) => {
  const perms = ctx.appJson?.expo?.android?.permissions ?? [];
  const all = ctx.files.map((f) => f.src).join('\n');
  for (const p of perms) {
    const needle = ANDROID_DANGEROUS[p];
    if (!needle) continue;
    if (needle.test(all)) continue;
    out(rule, ctx.appJsonFile, ctx.appJsonLine(p), `${p.split('.').pop()} is asked for and no code ever uses it. Google reads that as over-collection.`);
  }
};

D['AND-PERM-02'] = (ctx, rule, out) => {
  const perms = ctx.appJson?.expo?.android?.permissions ?? [];
  for (const p of perms) {
    if (/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/.test(p)) {
      out(rule, ctx.appJsonFile, ctx.appJsonLine(p), `${p} is the old, unlimited storage permission. Google Play does not accept it without a cap, and this app does not need it.`);
    }
  }
  const all = ctx.files.map((f) => f.src).join('\n');
  for (const p of perms) {
    if (!/READ_MEDIA_(IMAGES|VIDEO|AUDIO)/.test(p)) continue;
    if (/MediaLibrary|expo-media-library/.test(all)) continue;
    out(rule, ctx.appJsonFile, ctx.appJsonLine(p), `${p} is declared but the app only uses the system picker, which needs no permission at all.`);
  }
};

D['AND-PLAY-01'] = (ctx, rule, out) => {
  const plugins = JSON.stringify(ctx.appJson?.expo?.plugins ?? []);
  const m = /"targetSdkVersion"\s*:\s*(\d+)/.exec(plugins);
  if (!m) {
    out(rule, ctx.appJsonFile, 1, 'The Android target version is left to whatever Expo defaults to. Google Play requires a specific minimum, and a release gate cannot promise a default.');
    return;
  }
  if (Number(m[1]) < 35) {
    out(rule, ctx.appJsonFile, 1, `The Android target version is pinned at ${m[1]}. Google Play requires 35 or higher.`);
  }
};

// ── App Store and Google Play ────────────────────────────────────────────────

const IOS_PERMISSION_TRIGGERS = {
  NSCameraUsageDescription: /launchCameraAsync|requestCameraPermissionsAsync|expo-camera/,
  NSPhotoLibraryUsageDescription: /requestMediaLibraryPermissionsAsync|expo-media-library|MediaLibrary\./,
  NSPhotoLibraryAddUsageDescription: /saveToLibraryAsync|createAssetAsync/,
  NSMicrophoneUsageDescription: /AudioRecorder|useAudioRecorder|startRecording|launchCameraAsync[\s\S]{0,160}videos/,
  NSLocationWhenInUseUsageDescription: /expo-location|getCurrentPositionAsync|requestForegroundPermissions/,
  NSLocationAlwaysAndWhenInUseUsageDescription: /startLocationUpdatesAsync|requestBackgroundPermissions/,
};

D['OGN-IOS-009'] = (ctx, rule, out) => {
  const plist = ctx.appJson?.expo?.ios?.infoPlist ?? {};
  const all = ctx.files.map((f) => f.src).join('\n');
  for (const [key, value] of Object.entries(plist)) {
    if (!/UsageDescription$/.test(key)) continue;
    const trigger = IOS_PERMISSION_TRIGGERS[key];
    if (trigger && !trigger.test(all)) {
      out(rule, ctx.appJsonFile, ctx.appJsonLine(key), `${key} is declared and nothing in the app ever asks for it. App Review treats a permission you do not use as a reason to reject.`);
    }
    if (typeof value === 'string' && value.length < 40) {
      out(rule, ctx.appJsonFile, ctx.appJsonLine(key), `${key} is only ${value.length} characters. It has to name the feature it is for, in words a member would recognise.`);
    }
  }
};

D['OGN-IOS-010'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(/requestMediaLibraryPermissionsAsync|from\s*['"]expo-media-library['"]/g)) {
      out(rule, f, f.lineOf(m.index), 'This asks for the whole photo library. The system picker already gives one photo with no permission at all, and that is what the owner asked for.');
    }
  }
};

/**
 * Source with COMMENTS blanked but STRING LITERALS kept.
 *
 * `f.masked` blanks both, which is right for structural questions ("is there
 * a call here?") and wrong for content questions ("does this call name
 * 'delete-account'?"). A detector that looks for text INSIDE a string literal
 * must use this view, or it can never match anything.
 *
 * Found 2026-09-18: the account-deletion detector tested f.masked for
 * /functions\.invoke\(\s*['"][^'"]*delete[^'"]*account/ — a pattern that
 * requires characters between two quotes. Masked source never has any. So the
 * gate reported "no way to delete your account" while the call sat in
 * app/(tabs)/profile.tsx, and it would have blocked the release forever.
 */
function codeWithStrings(f) {
  if (f.__codeWithStrings) return f.__codeWithStrings;
  const out = f.src.split('');
  for (const c of f.comments || []) {
    for (let k = c.start; k < c.end && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  }
  f.__codeWithStrings = out.join('');
  return f.__codeWithStrings;
}

const accountDeletion = (ctx, rule, out) => {
  const all = ctx.files;
  const createsAccounts = all.some((f) => /auth\.signUp\s*\(/.test(f.masked));
  if (!createsAccounts) return;
  // codeWithStrings, NOT masked: this pattern looks INSIDE a string literal.
  const deletes = all.some((f) => /functions\.invoke\(\s*['"][^'"]*delete[^'"]*account|\.rpc\(\s*['"][^'"]*delete[^'"]*(account|user)|admin\.deleteUser/i.test(codeWithStrings(f)));
  if (!deletes) {
    const profile = ctx.byRel['app/(tabs)/profile.tsx'] ?? all[0];
    out(rule, profile, 1, 'The app creates accounts and has no code anywhere that deletes one. Apple requires deletion to start and finish inside the app.');
  }
  for (const f of all) {
    for (const m of codeWithStrings(f).matchAll(/mailto:/g)) {
      const around = f.src.slice(Math.max(0, m.index - 400), m.index + 200);
      if (!/delete|remov(e|al)|close (my )?account/i.test(around)) continue;
      out(rule, f, f.lineOf(m.index), 'Deleting an account opens an email draft asking a person to do it by hand. Both stores reject that.');
    }
  }
};
D['OGN-IOS-011'] = accountDeletion;
D['AND-PLAY-02'] = accountDeletion;

// ── Secrets ──────────────────────────────────────────────────────────────────
//
// This one is written defensively. It reports the file, the line, the variable
// name and the SHAPE of what it found, and it never puts the value anywhere —
// not in the text report, not in the JSON, not truncated, not hashed into
// something reversible. check-static.test.mjs proves it by planting a known
// value and asserting it appears nowhere in either output.

const SECRET_NAME = /(api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|client[_-]?secret|service[_-]?role|bearer|credential|access[_-]?key|auth[_-]?key)/i;
const SECRET_SHAPE = [
  { name: 'a JSON web token', re: /^eyJ[\w-]{8,}\.[\w-]{8,}\./ },
  { name: 'an OpenAI-style key', re: /^sk-[A-Za-z0-9_-]{16,}$/ },
  { name: 'a live Stripe key', re: /^(pk|sk|rk)_live_[A-Za-z0-9]{10,}$/ },
  { name: 'an AWS access key id', re: /^AKIA[0-9A-Z]{12,}$/ },
  { name: 'a GitHub token', re: /^gh[pousr]_[A-Za-z0-9]{20,}$/ },
  { name: 'a Google API key', re: /^AIza[0-9A-Za-z_-]{20,}$/ },
  { name: 'a long random-looking string', re: /^[A-Za-z0-9+/_-]{32,}={0,2}$/ },
];

/** Describe a value without ever repeating it. */
function describeShape(text) {
  for (const s of SECRET_SHAPE) if (s.re.test(text)) return s.name;
  return 'a string that could be a credential';
}

const PLACEHOLDER_VALUE = /^(your[-_ ]|xxx|placeholder|changeme|example|<.*>|\.\.\.|test|dummy|none|null|undefined)$/i;

D['GATE-NO-SECRETS'] = (ctx, rule, out) => {
  for (const f of ctx.files) {
    for (const s of f.strings) {
      const text = s.text;
      if (text.length < THRESHOLDS.secretMinLength) continue;
      if (PLACEHOLDER_VALUE.test(text.trim())) continue;
      if (/^https?:\/\//.test(text)) continue;
      if (/\s/.test(text)) continue;                        // a sentence, not a key
      const before = f.src.slice(Math.max(0, s.start - 90), s.start);
      const named = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/.exec(before);
      const varName = named ? named[1] : null;
      const nameLooksSecret = varName ? SECRET_NAME.test(varName) : false;
      const shapeLooksSecret = SECRET_SHAPE.slice(0, 6).some((x) => x.re.test(text));
      if (!nameLooksSecret && !shapeLooksSecret) continue;
      if (varName && /^(EXPO_PUBLIC_[A-Z_]+)$/.test(text)) continue;  // a variable NAME, not a value
      out(rule, f, f.lineOf(s.start), `${varName ? `\`${varName}\`` : 'A literal'} holds ${describeShape(text)} of ${text.length} characters, written straight into the code. The value is deliberately not printed here — open the file to see it, then move it out and rotate it.`);
    }
  }
};

D['NO-KEY-IN-BUNDLE'] = (ctx, rule, out) => {
  const PAID = /EXPO_PUBLIC_(BIBLE_API_KEY|[A-Z_]*API_KEY)/g;
  for (const f of ctx.files) {
    for (const m of f.masked.matchAll(PAID)) {
      const name = f.src.slice(m.index, m.index + m[0].length);
      out(rule, f, f.lineOf(m.index), `${name} is an EXPO_PUBLIC_ value, which means it is compiled into the app people download and can be read straight out of it. A paid key belongs behind a small server the app calls.`);
    }
  }
};

// ── app.json ─────────────────────────────────────────────────────────────────

D['GATE-IDENTITY-LOCK'] = (ctx, rule, out) => {
  const e = ctx.appJson?.expo ?? {};
  const checks = [
    ['ios.bundleIdentifier', e.ios?.bundleIdentifier, IDENTITY.iosBundleId],
    ['android.package', e.android?.package, IDENTITY.androidPackage],
    ['extra.eas.projectId', e.extra?.eas?.projectId, IDENTITY.easProjectId],
    ['scheme', e.scheme, IDENTITY.scheme],
  ];
  for (const [where, actual, expected] of checks) {
    if (actual === expected) continue;
    out(rule, ctx.appJsonFile, ctx.appJsonLine(where.split('.').pop()),
      `${where} is ${actual === undefined ? 'missing' : `"${actual}"`} and DO-NOT-BREAK.md pins it to "${expected}". Changing it makes this a different app to both stores: testers lose their install and over-the-air updates stop reaching the phones already out there.`);
  }
};

D['GATE-APP-JSON-ASSETS'] = (ctx, rule, out) => {
  const e = ctx.appJson?.expo ?? {};
  const required = [
    ['icon', e.icon],
    ['android.adaptiveIcon.foregroundImage', e.android?.adaptiveIcon?.foregroundImage],
  ];
  const splash = (e.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
  required.push(['expo-splash-screen image', splash?.[1]?.image]);
  for (const [label, value] of required) {
    if (!value) { out(rule, ctx.appJsonFile, 1, `${label} is not set in app.json. The store upload fails at the very end without it.`); continue; }
    const abs = resolve(ctx.root, String(value).replace(/^\.\//, ''));
    if (!existsSync(abs)) out(rule, ctx.appJsonFile, ctx.appJsonLine(label.split('.').pop()), `${label} points at ${value}, and that file is not on disk.`);
  }
  if (!e.scheme) out(rule, ctx.appJsonFile, 1, 'No app link (scheme) is set, so a shared story or sermon link opens a browser instead of the app.');
};

D['APP-JSON-RELEASE'] = (ctx, rule, out) => {
  const e = ctx.appJson?.expo ?? {};
  const appVersion = e.version;
  const pkgVersion = ctx.packageJson?.version;
  const storeVersion = ctx.storeConfig?.apple?.version;
  if (!appVersion) {
    out(rule, ctx.appJsonFile, 1, 'app.json has no version at all.');
  } else if (!/^\d+\.\d+\.\d+$/.test(String(appVersion))) {
    out(rule, ctx.appJsonFile, ctx.appJsonLine('version'), `The version "${appVersion}" is not three numbers. Both stores want 1.2.3.`);
  }
  const versions = { 'app.json': appVersion, 'package.json': pkgVersion, 'store.config.json': storeVersion };
  const distinct = [...new Set(Object.values(versions).filter(Boolean))];
  if (distinct.length > 1) {
    out(rule, ctx.appJsonFile, ctx.appJsonLine('version'),
      `Three files disagree about what version this is: ${Object.entries(versions).map(([k, v]) => `${k} says ${v}`).join(', ')}. Pick one before the upload.`);
  }
  const remoteVersions = ctx.easJson?.cli?.appVersionSource === 'remote';
  if (!remoteVersions) {
    if (e.ios?.buildNumber === undefined) out(rule, ctx.appJsonFile, 1, 'No iOS build number, and eas.json is not managing build numbers remotely either.');
    if (e.android?.versionCode === undefined) out(rule, ctx.appJsonFile, 1, 'No Android versionCode, and eas.json is not managing build numbers remotely either.');
  }
  if (e.userInterfaceStyle && e.userInterfaceStyle !== 'automatic') {
    out(rule, ctx.appJsonFile, ctx.appJsonLine('userInterfaceStyle'), `userInterfaceStyle is "${e.userInterfaceStyle}" while the app ships both themes.`);
  }
  const fg = e.android?.adaptiveIcon?.foregroundImage;
  if (fg) {
    const abs = resolve(ctx.root, String(fg).replace(/^\.\//, ''));
    const dims = imageSize(abs);
    if (dims && dims.width !== dims.height) {
      out(rule, ctx.appJsonFile, ctx.appJsonLine('foregroundImage'), `The Android icon artwork is ${dims.width}x${dims.height}. Android masks it to a circle, so it has to be square.`);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Running everything
// ─────────────────────────────────────────────────────────────────────────────

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function buildContext(opts) {
  const root = opts.root;
  const files = walkSource(root).map((p) => loadFile(p, root));
  const byRel = Object.fromEntries(files.map((f) => [f.rel, f]));
  const appJsonPath = join(root, 'app.json');
  const appJsonSrc = existsSync(appJsonPath) ? readFileSync(appJsonPath, 'utf8') : '{}';
  const appJsonLineOf = makeLineIndex(appJsonSrc);
  const appJsonFile = { rel: 'app.json', abs: appJsonPath, src: appJsonSrc, lineOf: appJsonLineOf, elements: [], styles: {}, strings: [], comments: [], masked: appJsonSrc };
  return {
    root,
    opts,
    files,
    byRel,
    appJson: readJson(appJsonPath),
    packageJson: readJson(join(root, 'package.json')),
    easJson: readJson(join(root, 'eas.json')),
    storeConfig: readJson(join(root, 'store.config.json')),
    themeColors: parseThemeColors(root),
    appJsonFile,
    appJsonLine: (key) => {
      const at = appJsonSrc.indexOf(`"${key}"`);
      return at === -1 ? 1 : appJsonLineOf(at);
    },
  };
}

export function loadBaseline(path) {
  if (!path) return { waived: [], path: null, missing: false };
  if (!existsSync(path)) return { waived: [], path, missing: true };
  const data = readJson(path) ?? {};
  return { waived: Array.isArray(data.waived) ? data.waived : [], path, missing: false, note: data.note, generated: data.generated };
}

/**
 * Forgive what was already agreed, and only what was already agreed. A waiver
 * is per rule, per file, with a count — so a seventh unlabelled image in a file
 * that had six waived still fails. That is what makes this switchable-on today
 * without hiding tomorrow's mistake.
 */
export function applyBaseline(findingsByRule, baseline) {
  const budget = new Map();
  for (const w of baseline.waived) budget.set(`${w.rule}::${w.file}`, (budget.get(`${w.rule}::${w.file}`) ?? 0) + (Number(w.allow) || 0));
  let waivedTotal = 0;
  const kept = new Map();
  for (const [ruleId, findings] of findingsByRule) {
    const survivors = [];
    let waived = 0;
    for (const fi of findings) {
      const key = `${ruleId}::${fi.file}`;
      const left = budget.get(key) ?? 0;
      if (left > 0) { budget.set(key, left - 1); waived += 1; waivedTotal += 1; continue; }
      survivors.push(fi);
    }
    kept.set(ruleId, { findings: survivors, waived });
  }
  return { kept, waivedTotal };
}

export function runGate(opts) {
  const ctx = buildContext(opts);
  const applicable = rulesFor(opts.platform);
  const findingsByRule = new Map();
  const errors = [];

  const out = (rule, file, line, detail) => {
    const list = findingsByRule.get(rule.id) ?? [];
    list.push({ file: file?.rel ?? 'app.json', line: line ?? 1, detail });
    findingsByRule.set(rule.id, list);
  };

  for (const rule of applicable) {
    if (rule.kind !== 'static') continue;
    const detector = D[rule.id];
    if (!detector) continue;
    if (!findingsByRule.has(rule.id)) findingsByRule.set(rule.id, []);
    try {
      detector(ctx, rule, out);
    } catch (err) {
      errors.push({ rule: rule.id, message: err?.message ?? String(err) });
    }
  }

  // Deliberately NOT collapsing findings that look alike. Three unlabelled
  // pictures written on one line are three unlabelled pictures, and a gate that
  // reported one of them would be under-counting the work. Rules that combine
  // two detectors are written so the two never say the same sentence.

  const baseline = loadBaseline(opts.baseline);
  const { kept, waivedTotal } = applyBaseline(findingsByRule, baseline);

  const results = applicable.map((rule) => {
    if (rule.kind === 'device') {
      return { ...ruleSummary(rule), status: 'not-checked', findings: [], waived: 0 };
    }
    if (!D[rule.id]) {
      return { ...ruleSummary(rule), status: 'no-detector', findings: [], waived: 0 };
    }
    const entry = kept.get(rule.id) ?? { findings: [], waived: 0 };
    return {
      ...ruleSummary(rule),
      status: entry.findings.length ? 'fail' : 'pass',
      findings: entry.findings,
      waived: entry.waived,
    };
  });

  const checked = results.filter((r) => r.status === 'pass' || r.status === 'fail');
  const failed = results.filter((r) => r.status === 'fail');
  const notChecked = results.filter((r) => r.status === 'not-checked' || r.status === 'no-detector');
  const blockersFailing = failed.filter((r) => r.severity === 'blocker');

  return {
    generatedAt: new Date().toISOString(),
    platform: opts.platform,
    root: ctx.root,
    baseline: baseline.path ? { path: baseline.path, missing: baseline.missing, waived: waivedTotal } : null,
    rules: results,
    errors,
    totals: {
      applicable: results.length,
      checkedStatically: checked.length,
      passed: checked.length - failed.length,
      failed: failed.length,
      notChecked: notChecked.length,
      waivedFindings: waivedTotal,
      findings: failed.reduce((n, r) => n + r.findings.length, 0),
      blockersFailing: blockersFailing.length,
    },
    exitCode: blockersFailing.length > 0 ? 1 : 0,
    ctx,
  };
}

function ruleSummary(rule) {
  return {
    id: rule.id,
    platform: rule.platform,
    severity: rule.severity,
    kind: rule.kind,
    theme: rule.theme,
    source: rule.source,
    title: rule.title,
    why: rule.why,
    deviceAlso: rule.deviceAlso ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Saying what happened
// ─────────────────────────────────────────────────────────────────────────────

const MARK = { fail: '✗', pass: '✓', 'not-checked': '·', 'no-detector': '·' };
const MAX_SHOWN = 6;

export function renderReport(report, opts) {
  const L = [];
  const sev = (s) => s.toUpperCase().padEnd(7);
  L.push('');
  L.push('  OVERCOMERS GLOBAL NETWORK — RELEASE GATE');
  L.push(`  ${report.platform === 'both' ? 'Apple and Google standards' : report.platform === 'ios' ? 'Apple standards' : 'Google standards'}  ·  ${new Date(report.generatedAt).toLocaleString()}`);
  L.push('');

  const byId = Object.fromEntries(report.rules.map((r) => [r.id, r]));
  for (const group of groupByTheme(report.rules.map((r) => RULES_BY_ID[r.id]))) {
    const rows = group.rules.map((r) => byId[r.id]);
    const failing = rows.filter((r) => r.status === 'fail');
    if (opts.quiet && !failing.length) continue;
    L.push(`  ${group.heading.toUpperCase()}`);
    for (const r of rows) {
      if (opts.quiet && r.status !== 'fail') continue;
      const tail = r.status === 'fail' ? `${r.findings.length} place${r.findings.length === 1 ? '' : 's'}`
        : r.status === 'pass' ? (r.waived ? `clean (${r.waived} agreed and set aside)` : 'clean')
        : 'NOT CHECKED — needs a device';
      L.push(`    ${MARK[r.status]} ${sev(r.severity)} ${r.id.padEnd(24)} ${r.title}`);
      L.push(`        ${tail}`);
      if (r.status === 'fail') {
        for (const f of r.findings.slice(0, MAX_SHOWN)) L.push(`        · ${f.file}:${f.line} — ${f.detail}`);
        if (r.findings.length > MAX_SHOWN) L.push(`        · …and ${r.findings.length - MAX_SHOWN} more like it`);
        if (r.waived) L.push(`        · ${r.waived} more were agreed earlier and set aside`);
      }
      if (r.deviceAlso && r.status !== 'not-checked') L.push(`        still owed on a device: ${r.deviceAlso}`);
      if (r.status === 'not-checked' && r.deviceAlso) L.push(`        why: ${r.deviceAlso}`);
    }
    L.push('');
  }

  const t = report.totals;
  const notChecked = report.rules.filter((r) => r.status === 'not-checked' || r.status === 'no-detector');
  L.push('  ───────────────────────────────────────────────────────────────────');
  L.push('  WHAT WAS ACTUALLY CHECKED');
  L.push('');
  L.push(`  ${t.applicable} rules apply to ${report.platform === 'both' ? 'this release' : report.platform}.`);
  const cleanOnTheirOwn = report.rules.filter((r) => r.status === 'pass' && !r.waived).length;
  const cleanByAgreement = report.rules.filter((r) => r.status === 'pass' && r.waived > 0).length;
  L.push(`  ${t.checkedStatically} were checked by reading the code.`);
  L.push(`      ${cleanOnTheirOwn} are clean.`);
  if (cleanByAgreement) L.push(`      ${cleanByAgreement} are clean ONLY because the baseline forgave what was already there.`);
  L.push(`      ${t.failed} are failing, in ${t.findings} place${t.findings === 1 ? '' : 's'}.`);
  L.push(`  ${t.notChecked} could NOT be checked here and were NOT counted as passing:`);
  for (const r of notChecked) L.push(`      ${r.id} — ${r.title}`);
  if (report.baseline) {
    L.push(`  ${t.waivedFindings} findings were set aside by the agreed baseline at ${report.baseline.path}.`);
    if (report.baseline.missing) L.push('      (that baseline file does not exist, so nothing was set aside)');
  } else {
    L.push('  No baseline was used, so nothing was set aside.');
  }
  const owed = report.rules.filter((r) => r.deviceAlso && r.status !== 'not-checked');
  if (owed.length) {
    L.push(`  ${owed.length} of the checked rules are only half-answerable from the code. What is still owed on a phone:`);
    for (const r of owed) L.push(`      ${r.id} — ${r.deviceAlso}`);
  }
  if (report.errors.length) {
    L.push('');
    L.push('  THESE CHECKS THEMSELVES FAILED TO RUN (treat as unchecked):');
    for (const e of report.errors) L.push(`      ${e.rule}: ${e.message}`);
  }
  L.push('');
  const blockers = report.rules.filter((r) => r.status === 'fail' && r.severity === 'blocker');
  if (blockers.length) {
    L.push(`  RELEASE BLOCKED. ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} failing:`);
    for (const b of blockers) L.push(`      ${b.id} — ${b.title}`);
  } else {
    L.push('  No blocker is failing. Nothing here stops the release.');
    L.push('  That is not the same as "everything is fine" — read the list above.');
  }
  L.push('');
  return L.join('\n');
}

/** Today's violations, written out as the agreed starting point. */
export function buildBaselineFile(report) {
  const waived = [];
  for (const r of report.rules) {
    if (r.status !== 'fail') continue;
    const byFile = new Map();
    for (const f of r.findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
    for (const [file, allow] of [...byFile].sort()) {
      waived.push({ rule: r.id, file, allow, severity: r.severity, what: r.title });
    }
  }
  return {
    generated: report.generatedAt,
    platform: report.platform,
    note: [
      'These are the problems that already existed on the day the gate was switched on.',
      'They are set aside so the gate can start working today instead of stopping the release.',
      'Nothing new is forgiven: add a seventh unlabelled picture to a file that had six,',
      'and the gate fails. Every line here is work still to do — shrink this file, never grow it.',
    ].join(' '),
    totalWaived: waived.reduce((n, w) => n + w.allow, 0),
    waived,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) { console.error(err.message); return 2; }
  if (opts.help) { console.log(HELP); return 0; }

  const report = runGate(opts);

  if (opts.writeBaseline) {
    const file = buildBaselineFile(report);
    writeFileSync(opts.writeBaseline, `${JSON.stringify(file, null, 2)}\n`);
    if (!opts.json) console.log(`Wrote ${file.totalWaived} agreed violations to ${opts.writeBaseline}.`);
  }

  if (opts.json) {
    const { ctx, ...clean } = report;
    console.log(JSON.stringify(clean, null, 2));
  } else {
    console.log(renderReport(report, opts));
  }
  return report.exitCode;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
