// Follow-up lists for each leader (owner's list, 2026-09-22): who is
// responsible, what is overdue, what "Followed up" writes, and the leaders'
// Team view counts. Pure logic, compiled with its imports stubbed.
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

class FriendlyError extends Error {}
const f = load('lib/followUps.ts', {
  FriendlyError, isMissingRelation: () => false, hasSupabase: false, supabase: {},
  pointFromEwkbHex: (hex) => (hex === 'EWKB' ? { latitude: 41, longitude: -81 } : null),
});

// Tuesday 22 September 2026, 10:30 local time.
const NOW = new Date(2026, 8, 22, 10, 30);
const at = (y, m, d, hh = 9) => new Date(y, m - 1, d, hh).toISOString();

const contact = (id, extra = {}) => ({ id, name: id, status: 'contact_made', followUpNeeded: true, ...extra });

test('who is responsible: the one assigned, else the one who wrote the record', () => {
  assert.equal(f.responsibleId({ assignedTo: 'ana', createdBy: 'ben' }), 'ana');
  assert.equal(f.responsibleId({ createdBy: 'ben' }), 'ben');
  assert.equal(f.responsibleId({}), undefined);
  // The database's insert rule on follow_up_notes says exactly the same.
  const sql = read('supabase/2026-09-22-outreach-follow-ups.sql');
  assert.match(sql, /c\.assigned_to = \(select auth\.uid\(\)\)\s+or \(c\.assigned_to is null and c\.created_by = \(select auth\.uid\(\)\)\)/);
});

test('due buckets and labels', () => {
  assert.equal(f.dueBucket(at(2026, 9, 21), NOW), 'overdue');
  assert.equal(f.dueBucket(at(2026, 9, 22, 8), NOW), 'today', 'earlier today is due today, not overdue');
  assert.equal(f.dueBucket(at(2026, 9, 22, 20), NOW), 'today');
  assert.equal(f.dueBucket(at(2026, 9, 23), NOW), 'upcoming');
  assert.equal(f.dueBucket(undefined, NOW), 'no_date');
  assert.equal(f.dueBucket('not a date', NOW), 'no_date');
  assert.equal(f.dueLabel(at(2026, 9, 14), NOW), 'Overdue since Mon 14 Sep');
  assert.equal(f.dueLabel(at(2026, 9, 22), NOW), 'Due today');
  assert.equal(f.dueLabel(at(2026, 9, 23), NOW), 'Due tomorrow');
  assert.equal(f.dueLabel(at(2026, 9, 25), NOW), 'Due Fri 25 Sep');
  assert.equal(f.dueLabel(undefined, NOW), 'No date set');
});

test('the list: overdue first, then today, then undated, then upcoming', () => {
  const contacts = [
    contact('upcoming', { nextFollowUpAt: at(2026, 9, 30), createdBy: 'me' }),
    contact('today', { nextFollowUpAt: at(2026, 9, 22, 18), createdBy: 'me' }),
    contact('older-overdue', { nextFollowUpAt: at(2026, 9, 10), createdBy: 'me' }),
    contact('undated-new', { createdAt: at(2026, 9, 20), createdBy: 'me' }),
    contact('overdue', { nextFollowUpAt: at(2026, 9, 20), createdBy: 'me' }),
    contact('undated-old', { createdAt: at(2026, 9, 1), createdBy: 'me' }),
    contact('done', { followUpNeeded: false, createdBy: 'me' }),
    contact('someone-elses', { nextFollowUpAt: at(2026, 9, 1), assignedTo: 'ana', createdBy: 'me' }),
  ];
  const items = f.buildFollowUpItems(contacts, [], [], NOW);
  const mine = f.myFollowUps(items, 'me');
  assert.deepEqual(mine.map((i) => i.contact.id), ['older-overdue', 'overdue', 'today', 'undated-old', 'undated-new', 'upcoming']);
  // Assigned to Ana: on Ana's list, not on the writer's.
  assert.deepEqual(f.myFollowUps(items, 'ana').map((i) => i.contact.id), ['someone-elses']);
  assert.deepEqual(f.myFollowUps(items, null), []);
});

test('an open task counts, and its sooner date wins; the record still decides who', () => {
  const contacts = [
    contact('a', { nextFollowUpAt: at(2026, 9, 30), createdBy: 'me' }),
    contact('b', { followUpNeeded: false, createdBy: 'me' }),
    contact('c', { followUpNeeded: false, createdBy: 'me' }),
  ];
  const tasks = [
    { id: 't1', contactId: 'a', assignedTo: 'me', dueAt: at(2026, 9, 21), status: 'open' },
    { id: 't2', contactId: 'b', assignedTo: 'ana', dueAt: at(2026, 9, 24), status: 'open' },
    { id: 't3', contactId: 'c', assignedTo: 'me', dueAt: at(2026, 9, 1), status: 'done' },
  ];
  const items = f.buildFollowUpItems(contacts, tasks, [], NOW);
  const a = items.find((i) => i.contact.id === 'a');
  assert.equal(a.bucket, 'overdue');
  assert.equal(a.dueAt, at(2026, 9, 21));
  const b = items.find((i) => i.contact.id === 'b');
  assert.equal(b.responsibleId, 'me', 'the task names Ana, but only the record\'s person may tick it off');
  assert.equal(items.find((i) => i.contact.id === 'c'), undefined, 'a finished task does not bring someone back');
});

test('"Followed up": outcome chips, next date and status only ever move forward', () => {
  assert.deepEqual(f.OUTCOMES.map((o) => o.key), ['reached', 'no_answer', 'prayed_with', 'invited', 'came_to_church', 'needs_another_call']);
  assert.equal(f.outcomeLabel('came_to_church'), 'Came to church');
  // The same six the database accepts.
  const sql = read('supabase/2026-09-22-outreach-follow-ups.sql');
  for (const { key } of f.OUTCOMES) assert.match(sql, new RegExp(`'${key}'`));

  assert.equal(f.defaultNextStep('no_answer'), 'tomorrow');
  assert.equal(f.defaultNextStep('needs_another_call'), 'three_days');
  assert.equal(f.defaultNextStep('came_to_church'), 'none');
  assert.equal(f.nextFollowUpDate('none', NOW), null);
  const tomorrow = f.nextFollowUpDate('tomorrow', NOW);
  assert.equal(tomorrow.getDate(), 23);
  assert.equal(tomorrow.getHours(), 9);
  assert.equal(f.nextFollowUpDate('next_week', NOW).getDate(), 29);
  assert.equal(f.nextFollowUpDate('two_weeks', NOW).getMonth(), 9, 'rolls into October');

  assert.equal(f.advanceStatus('contact_made', 'prayed_with'), 'prayed');
  assert.equal(f.advanceStatus('contact_made', 'invited'), 'invited');
  assert.equal(f.advanceStatus('prayed', 'came_to_church'), 'invited');
  assert.equal(f.advanceStatus('saved', 'prayed_with'), null, 'never marked back down');
  assert.equal(f.advanceStatus('invited', 'invited'), null);
  assert.equal(f.advanceStatus('not_interested', 'came_to_church'), 'invited');
  assert.equal(f.advanceStatus('contact_made', 'no_answer'), null);
});

test('history is kept: the database has no way to edit a note', () => {
  const sql = read('supabase/2026-09-22-outreach-follow-ups.sql');
  assert.doesNotMatch(sql, /for update/i);
  assert.match(sql, /revoke update on public\.follow_up_notes from authenticated/);
  assert.match(sql, /security invoker/);
  // The note and the record move together or not at all.
  assert.match(sql, /if v_rows = 0 then\s+raise exception/);
  // The app writes through the one transaction, never two separate calls.
  assert.match(read('lib/followUps.ts'), /supabase\.rpc\('record_follow_up'/);
});

test('Team view: grouped by leader, counted from real rows', () => {
  const contacts = [
    contact('a1', { assignedTo: 'ana', nextFollowUpAt: at(2026, 9, 1) }),
    contact('a2', { assignedTo: 'ana', nextFollowUpAt: at(2026, 9, 25) }),
    contact('b1', { createdBy: 'ben', nextFollowUpAt: at(2026, 9, 25) }),
    contact('nobody', {}),
  ];
  const notes = [
    { id: 'n1', contactId: 'x', authorId: 'cara', outcome: 'reached', createdAt: at(2026, 9, 20) },
    { id: 'n2', contactId: 'y', authorId: 'cara', outcome: 'reached', createdAt: at(2026, 9, 21) },
    { id: 'n3', contactId: 'z', authorId: 'ben', outcome: 'reached', createdAt: at(2026, 7, 1) },
    { id: 'n4', contactId: 'z', authorId: undefined, outcome: 'reached', createdAt: at(2026, 9, 21) },
  ];
  const items = f.buildFollowUpItems(contacts, [], notes, NOW);
  const groups = f.groupByLeader(items, notes, NOW);
  const byId = Object.fromEntries(groups.map((g) => [g.leaderId ?? 'unassigned', g]));
  assert.deepEqual([byId.ana.open, byId.ana.overdue, byId.ana.doneRecently], [2, 1, 0]);
  assert.deepEqual([byId.ben.open, byId.ben.overdue, byId.ben.doneRecently], [1, 0, 0], 'a July note is outside the 30 days');
  assert.deepEqual([byId.cara.open, byId.cara.overdue, byId.cara.doneRecently], [0, 0, 2]);
  assert.equal(byId.unassigned.open, 1);
  assert.equal(groups[0].leaderId, 'ana', 'most overdue first');
  // The newest note is what the list shows as "last note".
  const latest = f.latestNotes([
    { id: 'old', contactId: 'p', outcome: 'no_answer', createdAt: at(2026, 9, 1) },
    { id: 'new', contactId: 'p', outcome: 'reached', createdAt: at(2026, 9, 20) },
  ]);
  assert.equal(latest.get('p').id, 'new');
});

test('tap to call and WhatsApp', () => {
  assert.equal(f.telLink('(330) 555-0142'), 'tel:3305550142');
  assert.equal(f.telLink('+234 803 555 0142'), 'tel:+2348035550142');
  assert.equal(f.telLink('12'), null);
  assert.equal(f.telLink(undefined), null);
  assert.equal(f.whatsappLink('(330) 555-0142'), 'https://wa.me/13305550142');
  assert.equal(f.whatsappLink('+234 803 555 0142'), 'https://wa.me/2348035550142');
  assert.equal(f.whatsappLink('123'), null);
});

test('records from the database, including the hex point PostgREST returns', () => {
  const row = { id: 1, full_name: 'Mary', phone: '330', location: 'EWKB', status: 'invited', follow_up_needed: true, assigned_to: 'ana', assigned_leader_name: 'Ana', created_by: 'ben' };
  const mapped = f.mapContactRow(row);
  assert.equal(mapped.id, '1');
  assert.deepEqual(mapped.location, { latitude: 41, longitude: -81 });
  assert.equal(mapped.assignedTo, 'ana');
  assert.equal(f.mapContactRow({ ...row, location: { type: 'Point', coordinates: [-81.5, 41.1] } }).location.latitude, 41.1);
  assert.equal(f.mapContactRow({ ...row, location: null, follow_up_needed: null }).followUpNeeded, false);
});
