import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the pure helper so this suite also runs on the cloud's Node 20.
const source = readFileSync(new URL('../lib/mapGeometry.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const g = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

// A square region around a point, `half` degrees on each side.
const square = (lat, lng, half) => [
  { latitude: lat - half, longitude: lng - half },
  { latitude: lat - half, longitude: lng + half },
  { latitude: lat + half, longitude: lng + half },
  { latitude: lat + half, longitude: lng - half },
];
// Move a point east by a number of screen points at a zoom level.
const eastBy = (p, points, zoom) => ({ latitude: p.latitude, longitude: p.longitude + (points * 360) / (512 * 2 ** zoom) });

const HOUSTON = { latitude: 29.76, longitude: -95.37 };

test('projection: one screen point apart at the zoom it was measured', () => {
  const a = g.projectToWorld(HOUSTON, 14);
  const b = g.projectToWorld(eastBy(HOUSTON, 1, 14), 14);
  assert.ok(Math.abs(b.x - a.x - 1) < 1e-6);
  assert.ok(Math.abs(b.y - a.y) < 1e-9);
  // The world is 512 points wide at zoom 0.
  assert.ok(Math.abs(g.projectToWorld({ latitude: 0, longitude: 180 }, 0).x - 512) < 1e-9);
  assert.ok(Math.abs(g.projectToWorld({ latitude: 0, longitude: 0 }, 0).y - 256) < 1e-9);
});

test('point in ring: inside, outside, and the stored {latitude, longitude} shape', () => {
  const ring = square(HOUSTON.latitude, HOUSTON.longitude, 0.01);
  assert.equal(g.pointInGeoRing(HOUSTON, ring), true);
  assert.equal(g.pointInGeoRing({ latitude: 29.8, longitude: -95.37 }, ring), false);
  const closed = [...ring, ring[0]];
  assert.equal(g.pointInGeoRing(HOUSTON, closed), true);
});

test('distance to a segment clamps to the ends and handles a zero-length edge', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
  assert.equal(g.distanceToSegment({ x: 5, y: 3 }, a, b), 3);
  assert.equal(g.distanceToSegment({ x: -4, y: 3 }, a, b), 5);
  assert.equal(g.distanceToSegment({ x: 13, y: 4 }, a, b), 5);
  assert.equal(g.distanceToSegment({ x: 3, y: 4 }, a, a), 5);
  const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  // The closing edge (last → first) counts.
  assert.equal(g.distanceToRing({ x: -2, y: 5 }, ring), 2);
  assert.equal(g.ringArea(ring), 100);
});

test('smallest region wins: a tap on a street inside a city picks the street', () => {
  const city = { id: 'city', rings: [square(HOUSTON.latitude, HOUSTON.longitude, 0.2)] };
  const street = { id: 'street', rings: [square(HOUSTON.latitude, HOUSTON.longitude, 0.002)] };
  // City listed first — the old handler returned the first match, which was the city.
  const pick = g.pickAtTap({ tap: HOUSTON, zoom: 14, regions: [city, street] });
  assert.equal(pick.kind, 'region');
  assert.equal(pick.id, 'street');
  assert.equal(pick.inside, true);
  assert.equal(g.smallestContaining(HOUSTON, [city, street]), 'street');
  // Far from the street but inside the city: the city.
  const elsewhere = { latitude: HOUSTON.latitude + 0.1, longitude: HOUSTON.longitude };
  assert.equal(g.pickAtTap({ tap: elsewhere, zoom: 14, regions: [city, street] }).id, 'city');
});

test('near miss: a tap just outside a thin outline still selects it', () => {
  const zoom = 15;
  const ring = square(HOUSTON.latitude, HOUSTON.longitude, 0.0005);
  const region = { id: 'block', rings: [ring] };
  const eastEdge = { latitude: HOUSTON.latitude, longitude: HOUSTON.longitude + 0.0005 };
  // 15 points outside the east edge: selected.
  const near = g.pickAtTap({ tap: eastBy(eastEdge, 15, zoom), zoom, regions: [region] });
  assert.equal(near?.id, 'block');
  assert.equal(near.inside, false);
  assert.ok(near.distance > 14 && near.distance < 16);
  // 40 points outside: nothing — an empty tap clears the selection.
  assert.equal(g.pickAtTap({ tap: eastBy(eastEdge, 40, zoom), zoom, regions: [region] }), null);
  // The same geographic miss is forgiven when zoomed out (it is fewer points on screen).
  assert.equal(g.pickAtTap({ tap: eastBy(eastEdge, 40, zoom), zoom: zoom - 2, regions: [region] })?.id, 'block');
});

test('near miss on a small region beats being inside its big parent', () => {
  const zoom = 15;
  const parent = { id: 'city', rings: [square(HOUSTON.latitude, HOUSTON.longitude, 0.05)] };
  const child = { id: 'street', rings: [square(HOUSTON.latitude, HOUSTON.longitude, 0.0005)] };
  const eastEdge = { latitude: HOUSTON.latitude, longitude: HOUSTON.longitude + 0.0005 };
  assert.equal(g.pickAtTap({ tap: eastBy(eastEdge, 12, zoom), zoom, regions: [parent, child] }).id, 'street');
});

test('pins win over the outline under them, and the nearest pin wins', () => {
  const zoom = 14;
  const city = { id: 'city', rings: [square(HOUSTON.latitude, HOUSTON.longitude, 0.2)] };
  const pinA = { id: 'a', at: HOUSTON };
  const pinB = { id: 'b', at: eastBy(HOUSTON, 30, zoom) };
  const tap = eastBy(HOUSTON, 10, zoom);
  const pick = g.pickAtTap({ tap, zoom, regions: [city], pins: [pinA, pinB] });
  assert.deepEqual([pick.kind, pick.id], ['pin', 'a']);
  // Far from both pins: the outline under the tap.
  const far = { latitude: HOUSTON.latitude + 0.1, longitude: HOUSTON.longitude };
  assert.equal(g.pickAtTap({ tap: far, zoom, regions: [city], pins: [pinA, pinB] }).kind, 'region');
});

test('a teardrop pin is hit on its head, above its coordinate', () => {
  const zoom = 16;
  const pin = { id: 'visit', at: HOUSTON, radius: 14, offsetY: -22 };
  // 22 points north of the coordinate is the centre of the head.
  const scale = 512 * 2 ** zoom;
  const onHead = (() => {
    const p = g.projectToWorld(HOUSTON, zoom);
    const y = p.y - 22;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
    return { latitude: lat, longitude: HOUSTON.longitude };
  })();
  assert.equal(g.pickAtTap({ tap: onHead, zoom, regions: [], pins: [pin] })?.id, 'visit');
});

test('drawing: tap near the first corner closes, a double tap is ignored, otherwise a corner is added', () => {
  const zoom = 16;
  const corners = [HOUSTON, eastBy(HOUSTON, 200, zoom), { latitude: HOUSTON.latitude + 0.002, longitude: HOUSTON.longitude }];
  assert.deepEqual(g.classifyCornerTap(eastBy(HOUSTON, 12, zoom), corners, zoom), { action: 'close' });
  // With only two corners, the first corner cannot close anything yet.
  assert.equal(g.classifyCornerTap(eastBy(HOUSTON, 60, zoom), corners.slice(0, 2), zoom).action, 'add');
  const last = corners[corners.length - 1];
  assert.deepEqual(g.classifyCornerTap(eastBy(last, 4, zoom), corners, zoom), { action: 'ignore' });
  const added = g.classifyCornerTap(eastBy(HOUSTON, 400, zoom), corners, zoom);
  assert.equal(added.action, 'add');
  // Stored shape stays {latitude, longitude}.
  assert.deepEqual(Object.keys(added.point).sort(), ['latitude', 'longitude']);
  assert.equal(g.classifyCornerTap(HOUSTON, [], zoom).action, 'add');
});

test('drawing: the three-corner minimum is said in plain words', () => {
  assert.equal(g.MIN_CORNERS, 3);
  assert.match(g.cornerProgressMessage(0), /first corner/);
  assert.match(g.cornerProgressMessage(1), /tap 2 more spots/);
  assert.match(g.cornerProgressMessage(2), /tap 1 more spot\./);
  assert.match(g.cornerProgressMessage(3), /Done/);
  assert.ok(g.CORNER_HANDLE_RADIUS_PT * 2 >= 30, 'corner handles are at least 30pt across');
  assert.ok(g.TAP_TOLERANCE_PT >= 20 && g.TAP_TOLERANCE_PT <= 24);
});

test('a neighbour next door never steals a tap that landed inside the region beside it', () => {
  const zoom = 15;
  // Two regions sharing an edge at HOUSTON.longitude: a big one to the west, a small one to the east.
  const west = { id: 'west', rings: [[
    { latitude: HOUSTON.latitude - 0.01, longitude: HOUSTON.longitude - 0.02 },
    { latitude: HOUSTON.latitude - 0.01, longitude: HOUSTON.longitude },
    { latitude: HOUSTON.latitude + 0.01, longitude: HOUSTON.longitude },
    { latitude: HOUSTON.latitude + 0.01, longitude: HOUSTON.longitude - 0.02 },
  ]] };
  const east = { id: 'east', rings: [[
    { latitude: HOUSTON.latitude - 0.001, longitude: HOUSTON.longitude },
    { latitude: HOUSTON.latitude - 0.001, longitude: HOUSTON.longitude + 0.002 },
    { latitude: HOUSTON.latitude + 0.001, longitude: HOUSTON.longitude + 0.002 },
    { latitude: HOUSTON.latitude + 0.001, longitude: HOUSTON.longitude },
  ]] };
  // 10 points inside the big western region, next to the small eastern one.
  const tap = eastBy(HOUSTON, -10, zoom);
  assert.equal(g.pickAtTap({ tap, zoom, regions: [west, east] }).id, 'west');
  // Outside both, nearer the small one: the nearest wins.
  const outside = { latitude: HOUSTON.latitude + 0.0012, longitude: HOUSTON.longitude + 0.001 };
  assert.equal(g.pickAtTap({ tap: outside, zoom, regions: [west, east] })?.id, 'east');
});

test('label point: stored centre when inside, moved inside the outline when not', () => {
  const ring = square(HOUSTON.latitude, HOUSTON.longitude, 0.01);
  assert.deepEqual(g.labelPoint(HOUSTON, [ring]), HOUSTON);
  const far = { latitude: HOUSTON.latitude + 1, longitude: HOUSTON.longitude };
  const moved = g.labelPoint(far, [ring]);
  assert.equal(g.pointInGeoRing(moved, ring), true);
  // A U shape whose centroid falls in the gap: the label still lands inside.
  const u = [
    { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 3 }, { latitude: 3, longitude: 3 },
    { latitude: 3, longitude: 2 }, { latitude: 1, longitude: 2 }, { latitude: 1, longitude: 1 },
    { latitude: 3, longitude: 1 }, { latitude: 3, longitude: 0 },
  ];
  assert.equal(g.pointInGeoRing(g.labelPoint(null, [u]), u), true);
  assert.equal(g.labelPoint(HOUSTON, []), HOUSTON);
});
