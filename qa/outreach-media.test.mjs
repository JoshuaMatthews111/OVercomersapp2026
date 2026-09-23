// Photos and short clips on street-evangelism records (TestFlight 36), plus
// the visit-log column fix that had to land with them.
//
// Pure logic compiled with its imports stubbed — the same harness the rest of
// the outreach tests use — plus source checks on the migration and the screens
// for the rules that only a human can otherwise remember.
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

const MB = 1024 * 1024;
const formatBytes = (bytes) => (bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${Math.round(bytes / 1024)} KB`);

/** The real class's contract: friendlyError() passes it through untouched. */
class FriendlyError extends Error {
  constructor(message) { super(message); this.isFriendly = true; this.name = 'FriendlyError'; }
}

const m = load('lib/outreachMedia.ts', {
  supabase: {}, hasSupabase: false, isMissingRelation: () => false, FriendlyError,
  formatBytes, uploadPickedAsset: async () => { throw new Error('no uploads in tests'); },
  lookupPeople: async () => new Map(), friendlyError: (error, fallback) => (error && error.message) || fallback,
});

const e = load('lib/evangelismService.ts', {
  supabase: {}, hasSupabase: false, fetchWithTimeout: () => null,
  isMissingRelation: () => false, nominatimHeaders: () => ({}), waitForNominatimTurn: async () => {},
});

// ── where a file goes, and what the database checks it against ──────────────

test('the storage folder is the region, then the uploader — which is what the policies check', () => {
  assert.equal(m.outreachPathPrefix('region-1', 'user-9'), 'region-1/user-9');
  // A visit logged with no region still has a folder, and it is never empty:
  // an empty first segment would make folder 2 the uploader check's folder 1.
  assert.equal(m.outreachPathPrefix(null, 'user-9'), 'no-region/user-9');
  assert.equal(m.outreachPathPrefix(undefined, 'user-9'), 'no-region/user-9');
  assert.equal(m.outreachPathPrefix('', 'user-9'), 'no-region/user-9');

  // The migration's INSERT policy reads exactly these two segments. If this
  // shape ever changes, the policy has to change in the same commit.
  const sql = read('supabase/2026-09-23-outreach-media.sql');
  assert.match(sql, /split_part\(object_path, '\/', 2\) = auth\.uid\(\)::text/);
  assert.match(sql, /split_part\(object_path, '\/', 1\) = coalesce\(territory_id::text, 'no-region'\)/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text/);
});

test('a photo is a photo whatever it is called; anything else is refused by name', () => {
  // What the phone says it is comes first.
  assert.equal(m.outreachMediaKind('image/heic', 'weird.mp4'), 'photo');
  assert.equal(m.outreachMediaKind('video/quicktime', 'clip.jpg'), 'video');
  // With nothing declared, the name decides.
  assert.equal(m.outreachMediaKind(null, 'door.JPG'), 'photo');
  assert.equal(m.outreachMediaKind('', 'walk.mov'), 'video');
  assert.equal(m.outreachMediaKind(undefined, 'photo.heic?token=abc'), 'photo');
  // A document is not a picture, and an unknown file is never guessed into one.
  assert.equal(m.outreachMediaKind('application/pdf', 'tract.pdf'), null);
  assert.equal(m.outreachMediaKind(null, 'notes.txt'), null);
  assert.equal(m.outreachMediaKind(null, null), null);
});

// ── the refusals, which have to name real numbers ───────────────────────────

test('a clip over a minute is refused before it is sent, and says how long it ran', () => {
  const refusal = m.refuseOutreachFile({ kind: 'video', durationMs: 95_000 });
  assert.match(refusal, /1:35/);
  assert.match(refusal, /60 seconds/);
  // Exactly a minute is fine, and so is the second of slack the camera leaves.
  assert.equal(m.refuseOutreachFile({ kind: 'video', durationMs: 60_000 }), null);
  assert.equal(m.refuseOutreachFile({ kind: 'video', durationMs: 60_800 }), null);
  // A photo has no length, so length never refuses one.
  assert.equal(m.refuseOutreachFile({ kind: 'photo', durationMs: 900_000 }), null);
});

test('a file over the storage limit is refused with its real size, not a server error', () => {
  const refusal = m.refuseOutreachFile({ kind: 'video', sizeBytes: 45 * MB });
  assert.match(refusal, /45 MB/);
  assert.match(refusal, /20 MB/);
  assert.match(refusal, /shorter clip/);
  assert.equal(m.refuseOutreachFile({ kind: 'photo', sizeBytes: 19 * MB }), null);
  // Nothing a person reads may be developer language or a number with no unit.
  for (const text of [refusal, m.refuseOutreachFile({ kind: null }), m.OUTREACH_VIDEO_GUIDANCE]) {
    assert.doesNotMatch(text, /bucket|Supabase|RLS|row-level|undefined|null|NaN/i);
  }
});

test('the length rule is said before the camera opens, not after the upload', () => {
  assert.match(m.OUTREACH_VIDEO_GUIDANCE, /60 seconds/);
  // And it admits what the storage plan really allows, so the 60 seconds is
  // not a promise the free plan cannot keep.
  assert.match(m.OUTREACH_VIDEO_GUIDANCE, /20 MB/);
  assert.equal(m.OUTREACH_FILE_MAX_BYTES, 20 * MB);
  // The phone's own limit for this bucket must be the same number.
  assert.match(read('lib/uploadBody.ts'), /'outreach-private': 20 \* MB/);
  // And so must the bucket's, which the media migration deliberately leaves
  // alone: it adds video to the allowed types and changes nothing else.
  assert.match(read('supabase/storage_and_realtime.sql'), /'outreach-private', 'outreach-private', false, 20971520/);
  const migration = read('supabase/2026-09-23-outreach-media.sql');
  assert.doesNotMatch(migration, /set file_size_limit|file_size_limit =/);
  assert.match(migration, /'video\/mp4'/);
  assert.match(migration, /'video\/quicktime'/);
});

// ── what a person reads ─────────────────────────────────────────────────────

test('counts and durations read the way a person would say them', () => {
  assert.equal(m.mediaCountLabel([]), '');
  assert.equal(m.mediaCountLabel([{ kind: 'photo' }]), '1 photo');
  assert.equal(m.mediaCountLabel([{ kind: 'photo' }, { kind: 'photo' }]), '2 photos');
  assert.equal(m.mediaCountLabel([{ kind: 'photo' }, { kind: 'video' }]), '1 photo and 1 video');
  assert.equal(m.mediaCountLabel([{ kind: 'video' }, { kind: 'video' }]), '2 videos');

  assert.equal(m.durationLabel(64_000), '1:04');
  assert.equal(m.durationLabel(9_000), '0:09');
  assert.equal(m.durationLabel(0), '');
  assert.equal(m.durationLabel(undefined), '');
  assert.equal(m.durationLabel(NaN), '');
});

test('a screen reader is told who added it and what it is', () => {
  const spoken = m.describeMedia({ kind: 'video', authorName: 'Ana', durationMs: 32_000, caption: 'The corner shop' });
  assert.match(spoken, /Video/);
  assert.match(spoken, /Ana/);
  assert.match(spoken, /0:32/);
  assert.match(spoken, /The corner shop/);
  assert.match(m.describeMedia({ kind: 'photo', authorName: 'A team member' }), /^Photo added by A team member\. Open it$/);
});

// ── who may take a file back ────────────────────────────────────────────────

test('only the person who added a file, or staff, can take it off — the same rule the database keeps', () => {
  const mine = { createdBy: 'me' };
  assert.equal(m.canRemoveMedia(mine, 'me', false), true);
  assert.equal(m.canRemoveMedia(mine, 'someone-else', false), false);
  assert.equal(m.canRemoveMedia(mine, 'someone-else', true), true, 'staff may clear anything');
  assert.equal(m.canRemoveMedia(mine, null, false), false);
  assert.equal(m.canRemoveMedia(mine, undefined, false), false);

  // Review fix, 2026-09-23: the LIVE delete policy also asks whether the caller
  // is still on the outreach team, the way the bucket's own delete policy
  // always did. Somebody taken off the team kept the power to delete the rows
  // they filed while they were on it, which is a record of what was seen at a
  // door. is_staff_or_above() is a subset of is_outreach_or_above(), so nobody
  // who is really on the team lost anything.
  assert.match(
    read('supabase/2026-09-23-outreach-media-review-fixes.sql'),
    /for delete to authenticated\s*\nusing \(\s*\n\s*public\.is_outreach_or_above\(\)\s*\n\s*and \(created_by = auth\.uid\(\) or public\.is_staff_or_above\(\)\)/
  );
});

test('a removal that fails is described as a removal, not as an attachment', () => {
  // "this file was not attached" under a Remove button is copy that is not
  // true: a worker reading it would think the photo is still on the record.
  assert.match(m.friendlyRemoveError({ code: '42501' }), /take it off/);
  assert.doesNotMatch(m.friendlyRemoveError({ code: '42501' }), /attached/);
  assert.match(m.friendlyRemoveError({}), /taken off the record/);
  // Integration gate, same day: the wording is unchanged, but it now goes
  // through say() so it also reaches somebody using the web map, where
  // Alert.alert is an empty function (DO-NOT-BREAK #47/#50).
  assert.match(read('components/OutreachMedia.tsx'), /say\('Not removed', friendlyRemoveError\(error\)\)/);
});

test('an attachment is added or removed, never rewritten', () => {
  const sql = read('supabase/2026-09-23-outreach-media.sql');
  // No UPDATE policy and no UPDATE grant: the same shape follow_up_notes uses.
  assert.doesNotMatch(sql, /for update/i);
  assert.match(sql, /grant select, delete on public\.outreach_media to authenticated;/);
  assert.match(sql, /revoke all on public\.outreach_media from anon, authenticated, public;/);
  // Column-limited insert, so created_at cannot be back-dated.
  assert.match(sql, /grant insert \(/);
  assert.doesNotMatch(sql.slice(sql.indexOf('grant insert ('), sql.indexOf('grant insert (') + 300), /created_at/);
});

test('a member can never read an outreach attachment (DO-NOT-BREAK #2)', () => {
  const sql = read('supabase/2026-09-23-outreach-media.sql');
  assert.match(sql, /for select to authenticated\s*\n\s*using \(public\.is_outreach_or_above\(\)\)/);
  // And the bytes stay in the private bucket, read through signed links (#20).
  assert.match(read('lib/outreachMedia.ts'), /createSignedUrls/);
  assert.doesNotMatch(read('lib/outreachMedia.ts'), /getPublicUrl/);
  // uploadService must never treat this bucket as a public one.
  const upload = read('lib/uploadService.ts');
  const publicBuckets = /const publicBuckets = new Set\(\[([^\]]*)\]\)/.exec(upload);
  assert.ok(publicBuckets, 'the public bucket list should still be there');
  assert.doesNotMatch(publicBuckets[1], /outreach-private/);
});

test('the refusals a person sees name something they can do about it', () => {
  assert.match(m.friendlyAttachError({ code: '42501' }), /outreach team/);
  assert.match(m.friendlyAttachError({ code: '23503' }), /could not be found/);
  assert.match(m.friendlyAttachError({ code: '23505' }), /already on this record/);
  for (const code of ['42501', '23503', '23514', '23505', 'unknown']) {
    assert.doesNotMatch(m.friendlyAttachError({ code }), /Supabase|RLS|policy|constraint|violates/i);
  }
});

test('a photo cannot be attached under a region it was not filed in', async () => {
  // Pick a photo while Akron is selected, switch to Canton, then save. The
  // database would refuse it as a policy failure and the person would be told
  // they are not on the outreach team, which is not what happened.
  await assert.rejects(
    () => m.attachOutreachMedia({
      staged: { objectPath: 'akron/u1/1-door.jpg', territoryId: 'akron', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 100 },
      subjectType: 'visit', subjectId: 'v1', territoryId: 'canton', userId: 'u1',
    }),
    (error) => {
      assert.match(error.message, /different region/);
      assert.equal(error.isFriendly, true, 'wording written by hand must reach the person unchanged');
      return true;
    }
  );
  // And signed out, nothing is attempted at all.
  await assert.rejects(
    () => m.attachOutreachMedia({
      staged: { objectPath: 'akron/u1/1.jpg', territoryId: 'akron', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 1 },
      subjectType: 'visit', subjectId: 'v1', territoryId: 'akron', userId: '',
    }),
    /sign in again/
  );
});

// ── the visit log, which had to be fixed for any of this to be visible ──────

test('a visit is written with the column names the table really has', () => {
  const at = '2026-09-23T15:00:00.000Z';
  const row = e.visitInsertPayload(
    { territoryId: 'akron', placeLabel: 'Corner shop', unitNumber: '4B', notes: 'Prayed', location: { latitude: 41.08, longitude: -81.52 } },
    'user-1', at
  );
  assert.equal(row.latitude, 41.08);
  assert.equal(row.longitude, -81.52);
  assert.equal(row.visited_at, at);
  assert.equal(row.territory_id, 'akron');
  assert.equal(row.created_by, 'user-1');
  assert.equal(row.unit_number, '4B');
  // The columns the table does not have must not be sent.
  assert.equal(row.lat, undefined);
  assert.equal(row.lng, undefined);

  // A visit logged with location off still saves: the migration dropped the
  // NOT NULL that would have refused it.
  const noSpot = e.visitInsertPayload({ placeLabel: 'A doorway' }, 'user-1', at);
  assert.equal(noSpot.latitude, null);
  assert.equal(noSpot.longitude, null);
  assert.equal(noSpot.territory_id, null);
  assert.match(read('supabase/2026-09-23-outreach-media.sql'), /alter column latitude drop not null/);
});

test('a database that has not had the migration is still written to, in its own shape', () => {
  const legacy = e.visitInsertPayload(
    { placeLabel: 'Corner shop', location: { latitude: 1, longitude: 2 } }, 'user-1', '2026-09-23T15:00:00.000Z', 'legacy'
  );
  // The retry drops ONLY visited_at. The place columns have always been called
  // latitude/longitude; writing lat/lng here would be a second certain 42703,
  // so the fallback would look present and never once work.
  assert.equal(legacy.latitude, 1);
  assert.equal(legacy.longitude, 2);
  assert.equal(legacy.lat, undefined, 'lat/lng never existed in any database');
  assert.equal(legacy.lng, undefined);
  assert.equal(legacy.visited_at, undefined, 'the old table has no visited_at to write');
  // And the retry that uses it is really wired up.
  assert.match(read('lib/evangelismService.ts'), /isUndefinedColumn\(error\)/);
});

test('a visit pin reads correctly from either column shape', () => {
  const names = new Map([['user-1', 'Ana']]);
  const current = e.mapVisitRow({ id: 'v1', created_by: 'user-1', place_label: 'Shop', latitude: 41.08, longitude: -81.52, visited_at: '2026-09-23T10:00:00Z' }, names);
  assert.deepEqual(current.location, { latitude: 41.08, longitude: -81.52 });
  assert.equal(current.authorName, 'Ana');
  assert.equal(current.visitedAt, '2026-09-23T10:00:00Z');

  const legacy = e.mapVisitRow({ id: 'v2', created_by: 'user-2', lat: 1, lng: 2, created_at: '2026-09-22T10:00:00Z' }, names);
  assert.deepEqual(legacy.location, { latitude: 1, longitude: 2 });
  assert.equal(legacy.authorName, 'A team member', 'a name we do not have is never invented');
  assert.equal(legacy.placeLabel, 'A place we visited');
  assert.equal(legacy.visitedAt, '2026-09-22T10:00:00Z');

  // A visit with no spot is still a visit; it just has no pin.
  assert.equal(e.mapVisitRow({ id: 'v3', place_label: 'A doorway' }, names).location, undefined);
});

// ── the screens ─────────────────────────────────────────────────────────────

test('the map attaches photos only after the record it belongs to is saved', () => {
  const native = read('app/maps.native.tsx');
  // The visit row comes back first, and its id is what the files are filed on.
  assert.match(native, /const attached = await visitMedia\.attachTo\(result\.visit\.id/);
  assert.match(native, /const attached = await recordMedia\.attachTo\(saved\.id/);
  // Cancelling takes the already-uploaded files back out of the bucket.
  assert.match(native, /visitMedia\.discardAll\(\)/);
  // And a problem attaching is reported without losing the record.
  assert.match(native, /Visit saved, photos not all attached/);
  assert.match(native, /Record saved, photos not all attached/);
});

test('a pop-up over the map is opaque in both themes (DO-NOT-BREAK #43)', () => {
  const component = read('components/OutreachMedia.tsx');
  assert.match(component, /viewerCard: \{[^}]*backgroundColor: t\.colors\.sheet/);
  assert.doesNotMatch(component, /viewerCard: \{[^}]*surfaceRaised/);
});

test('a clip is played by a plain player that never runs in the background (#17/#24/#36)', () => {
  const component = read('components/OutreachMedia.tsx');
  assert.match(component, /useVideoPlayer\(uri\)/);
  assert.doesNotMatch(component, /staysActiveInBackground|showNowPlayingNotification|supportsBackgroundPlayback/);
  // And it never reaches for the one shared player or its audio mode.
  assert.doesNotMatch(component, /nowPlaying|PLAYBACK_AUDIO_MODE|setAudioModeAsync/);
});

test('saving never leaves a file in the bucket with nothing pointing at it', () => {
  // Review find, 2026-09-23. attachTo() cleared the draft list without stopping
  // an upload still on the wire and without taking back a staged file whose row
  // was refused — on a 1 GB plan those bytes would sit there for ever, which is
  // exactly what DO-NOT-BREAK #58 says must not happen.
  const component = read('components/OutreachMedia.tsx');
  const attachTo = component.slice(component.indexOf('const attachTo ='), component.indexOf('return { items, add'));
  assert.match(attachTo, /aborts\.current\.get\(entry\.key\)\?\.abort\(\)/, 'an upload still going is stopped');
  assert.match(attachTo, /discardOutreachUpload\(entry\.staged\.objectPath\)/, 'and anything without a row is taken back');
  // And the sentence it shows promises nothing the app cannot do: a saved
  // record has no Add button yet, so "add it again from the record" was a lie.
  assert.doesNotMatch(attachTo, /again from the record/);
  assert.match(attachTo, /Everything you typed was kept/);
});

test('a draft of photos never follows the person to the next visit or the next region', () => {
  // Review find, 2026-09-23. beginVisit() blanked the typed fields but not the
  // pictures, and the tab strip above the sheet can leave the form without
  // cancelling it. A photo picked for one doorway would have been written onto
  // the NEXT visit logged — or, if the region had changed, refused with a
  // message about a record the worker had never put a photo on.
  const native = read('app/maps.native.tsx');
  assert.match(native, /const visitDraftKey = sheet === 'visit' \? `visit:\$\{selected\?\.id \|\| 'no-region'\}` : 'closed'/);
  assert.match(native, /const recordDraftKey = sheet === 'record' \? `record:\$\{selected\?\.id \|\| 'no-region'\}` : 'closed'/);
  assert.match(native, /useEffect\(\(\) => \(\) => \{ visitMedia\.discardAll\(\); \}, \[visitDraftKey\]\)/);
  assert.match(native, /useEffect\(\(\) => \(\) => \{ recordMedia\.discardAll\(\); \}, \[recordDraftKey\]\)/);
});

test('a photo that cannot load says so on both maps, not only the phone', () => {
  // The browser map used to swallow the failure and draw an empty strip, which
  // reads as "there were no photos" on a record that has them.
  for (const file of ['app/maps.native.tsx', 'app/maps.tsx']) {
    const source = read(file);
    assert.match(source, /Photos on outreach records are not switched on yet\./, `${file} should name a missing table`);
    assert.match(source, /The photos could not load just now\./, `${file} should name a failed read`);
    assert.match(source, /\{mediaNote \? <Text style=\{styles\.empty\}>\{mediaNote\}<\/Text> : null\}/, `${file} should draw it`);
  }
});

test('the media the map shows is only ever drawn on outreach screens', () => {
  // The component is used by the map, and nowhere a member can reach.
  for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/messages.tsx', 'app/chat-room.tsx']) {
    assert.doesNotMatch(read(file), /OutreachMedia/, `${file} must not show outreach photos`);
  }
});
