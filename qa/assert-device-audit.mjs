import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(report.signedIn, true, 'The QA account never reached the signed-in app.');
assert.ok(report.liveControls > 0, 'No working controls were exercised.');
assert.equal(report.sessionFlow?.signedOut, true, 'Sign-out was not verified.');
assert.equal(report.sessionFlow?.signedBackIn, true, 'Signing back in was not verified.');
assert.equal(report.deadControls.length, 0, 'Dead controls require screenshot review.');
assert.equal(report.blankScreens?.length || 0, 0, 'Blank screens were observed.');
console.log('Signed-in controls and sign-out/recovery verified.');
