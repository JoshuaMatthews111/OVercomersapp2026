const fs = require('fs');
const path = require('path');

const root = process.cwd();
const sourceDirs = ['app', 'components', 'lib'];
const routeFiles = new Set();
const findings = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (/\.(tsx?|jsx?)$/.test(entry.name)) return [full];
    return [];
  });
}

for (const file of walk(path.join(root, 'app'))) {
  const rel = path.relative(path.join(root, 'app'), file);
  if (path.basename(rel).startsWith('._')) {
    findings.push({ severity: 'error', file, message: 'AppleDouble metadata file inside Expo Router app directory.' });
  }
  const normalized = rel
    .replace(/\.(native\.)?tsx?$/, '')
    .replace(/\/index$/, '')
    .replace(/\\/g, '/');
  routeFiles.add('/' + normalized);
}

for (const dir of sourceDirs) {
  for (const file of walk(path.join(root, dir))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    if (/NIV|ERV/.test(text)) {
      findings.push({ severity: 'warn', file: rel, message: 'Legacy NIV/ERV text remains; MVP Bible versions are KJV, NLT, AMP.' });
    }
    const reviewerRiskLines = text
      .split('\n')
      .filter((line) => /coming soon|next native|next pass|PLACEHOLDER_|not implemented/i.test(line))
      .filter((line) => !/placeholder(TextColor)?=/.test(line));
    if (reviewerRiskLines.length) {
      findings.push({ severity: 'warn', file: rel, message: 'Reviewer-risk unfinished wording found.' });
    }
    for (const match of text.matchAll(/router\.(push|replace)\(\s*['"`]([^'"`]+)['"`]/g)) {
      const target = match[2].replace(/ as any$/, '');
      if (target.startsWith('/(tabs)/')) continue;
      if (target === '/') continue;
      if (!routeFiles.has(target)) {
        findings.push({ severity: 'warn', file: rel, message: `Route target may be missing: ${target}` });
      }
    }
  }
}

if (findings.length) {
  for (const item of findings) {
    console.log(`[${item.severity}] ${item.file}: ${item.message}`);
  }
  if (findings.some((item) => item.severity === 'error')) process.exit(1);
} else {
  console.log('Mobile release static audit passed.');
}
