// Integration gate, 2026-09-23.
//
// The five lanes that landed today (bookaudio, outreach, settings, groups,
// live) each reviewed their own files. These are the two things the gate found
// BETWEEN them — a rule one lane wrote and another lane's file did not keep —
// held here so neither can quietly come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Lines of source with // comments and /* *​/ blocks taken out. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

test('an outreach photo refusal reaches the person on the web build too', () => {
  // DO-NOT-BREAK #47 and #50: react-native-web ships
  // `class Alert { static alert() {} }`. The groups lane put every notice in
  // components/ChatAttachments.tsx through a say() helper on the same day;
  // components/OutreachMedia.tsx fixed only its QUESTION (window.confirm) and
  // left the two answers that come back after "Remove" as bare Alert.alert —
  // and OutreachMediaStrip is drawn on the web map (app/maps.tsx). On a
  // computer a refused removal then looked exactly like one that worked.
  const src = code(read('components/OutreachMedia.tsx'));
  assert.match(src, /function say\(title: string, body: string\)/, 'OutreachMedia needs the same say() helper ChatAttachments has');
  assert.match(src, /Platform\.OS === 'web'[\s\S]{0,200}window\.alert/, 'say() must use window.alert on the web build');

  // Exactly two Alert.alert calls may remain: the phone branch inside say(),
  // and the phone branch of confirmRemove (whose web branch is window.confirm).
  const bare = src.match(/Alert\.alert\(/g) || [];
  assert.equal(bare.length, 2, `every notice must go through say(); found ${bare.length} Alert.alert calls`);
  assert.match(src, /if \(Platform\.OS === 'web'\)[\s\S]{0,300}window\.confirm/, 'the Remove question keeps its web branch');

  // The phone wording is untouched: these are the notices that shipped.
  assert.ok(src.includes("say('Not removed', friendlyRemoveError(error))"));
  assert.ok(src.includes("say('Taken off the record'"));
  assert.ok(src.includes("say('Camera access needed'"));
});

test('the outreach bucket and the outreach row agree about whose folder a file goes in', () => {
  // DO-NOT-BREAK #56 says the path is not cosmetic: folder 1 is the region and
  // folder 2 is the person filing it. public.outreach_media's INSERT policy
  // says so; the BUCKET's INSERT policy did not, so anyone on the outreach
  // team could write bytes into another worker's folder — bytes they could
  // then neither reach (no row) nor delete (the bucket's DELETE policy uses
  // folder 2), on a free 1 GB plan that started taking 20 MB clips today.
  const path = 'supabase/2026-09-23-outreach-bucket-upload-folder.sql';
  assert.ok(existsSync(join(root, path)), `${path} must be checked in beside the migration that was applied`);
  const sql = read(path);
  assert.match(sql, /create policy "outreach team uploads private outreach files" on storage\.objects/);
  assert.match(sql, /bucket_id = 'outreach-private'/);
  assert.match(sql, /public\.is_outreach_or_above\(\)/, 'the team test must not be weakened');
  assert.match(sql, /\(storage\.foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text/, 'folder 2 must be the uploader');

  // And the app really does write that shape, so nothing it does changes.
  const lib = read('lib/outreachMedia.ts');
  assert.match(lib, /\$\{territoryId \|\| 'no-region'\}\/\$\{userId\}/);
});
