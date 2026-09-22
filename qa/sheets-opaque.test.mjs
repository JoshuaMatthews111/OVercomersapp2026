// Pop-ups must be opaque in both themes. In the dark theme surfaceRaised is 8%
// white, so a menu painted with it let the chat show straight through — the
// owner saw it on the delete menu (2026-09-22). Every style whose name says it
// is a pop-up (sheet, menu, modal, dialog, popover, picker, drawer) must use
// theme.colors.sheet (or another opaque token), never surface/surfaceRaised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function styleBlocks(src) {
  const out = [];
  const re = /\n\s+([A-Za-z0-9_]+):\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length;
    while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    out.push({ key: m[1], body: src.slice(m.index + m[0].length, i) });
  }
  return out;
}

test('no pop-up is painted with a see-through surface', () => {
  const bad = [];
  for (const f of [...walk(join(root, 'app')), ...walk(join(root, 'components'))]) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('<Modal')) continue;
    for (const { key, body } of styleBlocks(src)) {
      if (!/sheet|menu|modal|dialog|popover|picker|drawer/i.test(key)) continue;
      if (/Backdrop|Handle|Grab|Title|Header|Head|Sub|Close|Row|Text|Button|Dismiss|Lift|Root|Body|Art/i.test(key)) continue;
      if (/backgroundColor:\s*(t|theme)\.colors\.(surface|surfaceRaised)\b/.test(body)) bad.push(`${f.replace(root, '')} ${key}`);
    }
  }
  assert.deepEqual(bad, [], `translucent pop-up backgrounds:\n${bad.join('\n')}`);
});

test('the sheet token exists and is opaque in both themes', () => {
  const theme = readFileSync(join(root, 'lib/theme.ts'), 'utf8');
  const values = [...theme.matchAll(/\n\s+sheet:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(values.length, 2, 'one sheet value per theme');
  for (const v of values) assert.match(v, /^#[0-9A-Fa-f]{6}$/, `sheet must be an opaque hex colour, got ${v}`);
});
