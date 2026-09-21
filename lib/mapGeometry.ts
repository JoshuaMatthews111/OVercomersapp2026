// Pure map geometry for the evangelism map. No React, no MapLibre, no imports,
// so the QA suite can compile and test it on its own (qa/map-geometry.test.mjs).
//
// Why this exists: the owner found it "hard to highlight an area". The old tap
// handler took the raw tap point, walked the regions in load order and picked
// the FIRST outline that contained it. On a phone that meant:
//   - a tap inside a street that sits inside a city picked the city,
//   - a tap a few points outside a thin outline picked nothing,
//   - a tap beside a pin picked the big region under the pin.
// Everything below works in SCREEN POINTS, so "close enough" means the same
// thing to a finger at every zoom level.
//
// Points stay {latitude, longitude} everywhere (DO-NOT-BREAK "Map engine").
// They are only projected here, for measuring, and never stored projected.

export type GeoPoint = { latitude: number; longitude: number };
export type ScreenPoint = { x: number; y: number };

/** How far a finger may miss an outline or a pin and still get it (points). */
export const TAP_TOLERANCE_PT = 22;
/** Radius of a drawn corner handle. Handles are 30pt across. */
export const CORNER_HANDLE_RADIUS_PT = 15;
/** Tapping this close to the first corner closes the outline. */
export const CLOSE_RING_RADIUS_PT = 28;
/** A second tap this close to the last corner is a double tap, not a corner. */
export const DUPLICATE_CORNER_PT = 10;
/** An outline needs at least this many corners. */
export const MIN_CORNERS = 3;

/** MapLibre's world is 512 points wide at zoom 0. */
const WORLD_SIZE_AT_ZOOM_0 = 512;
const MAX_MERCATOR_SIN = 0.9999;

/**
 * Where a place sits in the Web Mercator "world" at a zoom level, in points.
 * Two projected places are exactly as far apart as they look on screen (for a
 * flat, un-pitched map; rotation does not change distances).
 */
export function projectToWorld(p: GeoPoint, zoom: number): ScreenPoint {
  const scale = WORLD_SIZE_AT_ZOOM_0 * Math.pow(2, zoom);
  const sin = Math.max(-MAX_MERCATOR_SIN, Math.min(MAX_MERCATOR_SIN, Math.sin((p.latitude * Math.PI) / 180)));
  return {
    x: ((p.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** Ray casting on a ring of screen points. The ring may or may not repeat its first point. */
export function pointInScreenRing(point: ScreenPoint, ring: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** The same rule on stored {latitude, longitude} points. Zoom-free. */
export function pointInGeoRing(point: GeoPoint, ring: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude, yi = ring[i].latitude;
    const xj = ring[j].longitude, yj = ring[j].latitude;
    const crosses = (yi > point.latitude) !== (yj > point.latitude) &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to the segment a–b. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from a point to a ring's outline, closing edge included. */
export function distanceToRing(p: ScreenPoint, ring: ScreenPoint[]): number {
  if (!ring.length) return Infinity;
  if (ring.length === 1) return Math.hypot(p.x - ring[0].x, p.y - ring[0].y);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, ring[j], ring[i]));
  }
  return best;
}

/** Area enclosed by a ring (shoelace), always positive. */
export function ringArea(ring: ScreenPoint[]): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += (ring[j].x * ring[i].y) - (ring[i].x * ring[j].y);
  }
  return Math.abs(twice) / 2;
}

export type RegionShape = { id: string; rings: GeoPoint[][] };
/** A pin drawn on the map. offsetY moves the pin's visual centre off its
 *  coordinate (a teardrop anchored at its tip has its head above the point). */
export type PinShape = { id: string; at: GeoPoint; radius?: number; offsetY?: number };

export type TapPick =
  | { kind: 'pin'; id: string; distance: number }
  | { kind: 'region'; id: string; inside: boolean; distance: number; area: number };

type PickInput = {
  tap: GeoPoint;
  zoom: number;
  regions: RegionShape[];
  pins?: PinShape[];
  tolerance?: number;
};

/**
 * What a finger meant when it tapped the map.
 *
 * 1. A pin wins if the tap landed on it or within `tolerance` of its edge —
 *    pins are drawn on top of outlines, so that is what the finger was aiming at.
 *    The nearest pin wins.
 * 2. Otherwise, if the tap is INSIDE one or more outlines, the SMALLEST of
 *    those wins. A street inside a city inside a state is picked by tapping
 *    the street. The bigger regions stay reachable by tapping away from the
 *    small ones, or through "Zoom out to…".
 *    A near miss (within `tolerance`, outside) only beats that when the missed
 *    outline sits INSIDE the one the tap landed in — a thin street just missed
 *    inside its city. A neighbouring region next door never steals a tap that
 *    landed clearly inside the region beside it.
 * 3. If the tap is inside nothing, the NEAREST outline within `tolerance` wins
 *    (smaller breaks a tie).
 * 4. Nothing near: null. The caller clears the selection.
 */
export function pickAtTap({ tap, zoom, regions, pins = [], tolerance = TAP_TOLERANCE_PT }: PickInput): TapPick | null {
  const at = projectToWorld(tap, zoom);

  let bestPin: { id: string; distance: number } | null = null;
  for (const pin of pins) {
    const centre = projectToWorld(pin.at, zoom);
    centre.y += pin.offsetY || 0;
    const distance = Math.max(0, Math.hypot(at.x - centre.x, at.y - centre.y) - (pin.radius ?? 16));
    if (distance <= tolerance && (!bestPin || distance < bestPin.distance)) bestPin = { id: pin.id, distance };
  }
  if (bestPin) return { kind: 'pin', ...bestPin };

  type Hit = Extract<TapPick, { kind: 'region' }> & { ring: ScreenPoint[] };
  let inside: Hit | null = null;
  const near: Hit[] = [];
  for (const region of regions) {
    for (const geoRing of region.rings) {
      if (geoRing.length < 3) continue;
      const ring = geoRing.map((p) => projectToWorld(p, zoom));
      const isInside = pointInScreenRing(at, ring);
      const distance = isInside ? 0 : distanceToRing(at, ring);
      if (!isInside && distance > tolerance) continue;
      const hit: Hit = { kind: 'region', id: region.id, inside: isInside, distance, area: ringArea(ring), ring };
      if (isInside) {
        if (!inside || hit.area < inside.area - 1e-9) inside = hit;
      } else {
        near.push(hit);
      }
    }
  }
  const byNearest = (a: Hit, b: Hit) => (a.distance - b.distance) || (a.area - b.area);
  let best: Hit | null = inside;
  if (inside) {
    const base = inside;
    const nested = near
      .filter((h) => h.id !== base.id && h.area < base.area && h.ring.every((p) => pointInScreenRing(p, base.ring)))
      .sort(byNearest);
    if (nested.length) best = nested[0];
  } else if (near.length) {
    best = near.sort(byNearest)[0];
  }
  if (!best) return null;
  return { kind: 'region', id: best.id, inside: best.inside, distance: best.distance, area: best.area };
}

/**
 * Where to write a region's name on the map. The stored centre when it sits
 * inside the outline; otherwise the centre of the largest ring's area; if even
 * that falls outside (a C- or U-shaped outline), the middle of that ring's
 * longest inside chord along its centre line. Never a spot outside the shape
 * when one inside can be found.
 */
export function labelPoint(center: GeoPoint | null | undefined, rings: GeoPoint[][]): GeoPoint | null {
  const usable = rings.filter((r) => r.length >= 3);
  if (!usable.length) return center || null;
  if (center && usable.some((r) => pointInGeoRing(center, r))) return center;
  const flat = (r: GeoPoint[]) => r.map((p) => ({ x: p.longitude, y: p.latitude }));
  const ring = usable.reduce((a, b) => (ringArea(flat(b)) > ringArea(flat(a)) ? b : a));
  // Area-weighted centroid (shoelace).
  let cx = 0, cy = 0, twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].longitude * ring[i].latitude - ring[i].longitude * ring[j].latitude;
    twice += cross;
    cx += (ring[j].longitude + ring[i].longitude) * cross;
    cy += (ring[j].latitude + ring[i].latitude) * cross;
  }
  if (Math.abs(twice) > 1e-12) {
    const centroid = { latitude: cy / (3 * twice), longitude: cx / (3 * twice) };
    if (pointInGeoRing(centroid, ring)) return centroid;
  }
  // Fallback: cross the ring horizontally through its middle latitude and take
  // the midpoint of the widest stretch that is inside it.
  const lats = ring.map((p) => p.latitude);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.latitude > midLat) !== (b.latitude > midLat)) {
      xs.push(a.longitude + ((midLat - a.latitude) * (b.longitude - a.longitude)) / (b.latitude - a.latitude));
    }
  }
  xs.sort((a, b) => a - b);
  let bestMid: number | null = null, bestWidth = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > bestWidth) { bestWidth = xs[k + 1] - xs[k]; bestMid = (xs[k] + xs[k + 1]) / 2; }
  }
  return bestMid === null ? center || ring[0] : { latitude: midLat, longitude: bestMid };
}

/**
 * The smallest outline that contains a point, with no tolerance and no zoom.
 * Used where there is no screen to measure against (the web list, tests).
 */
export function smallestContaining(point: GeoPoint, regions: RegionShape[]): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  for (const region of regions) {
    for (const ring of region.rings) {
      if (ring.length < 3 || !pointInGeoRing(point, ring)) continue;
      // Area in degrees² scaled by latitude is enough to rank rings near each other.
      const cos = Math.cos((point.latitude * Math.PI) / 180) || 1;
      const area = ringArea(ring.map((p) => ({ x: p.longitude * cos, y: p.latitude })));
      if (area < bestArea) { bestArea = area; bestId = region.id; }
    }
  }
  return bestId;
}

export type CornerTap =
  | { action: 'close' }
  | { action: 'ignore' }
  | { action: 'add'; point: GeoPoint };

/**
 * What a tap means while someone is outlining a region by hand.
 * - Near the first corner, with enough corners already: close the outline.
 * - Right on top of the last corner (a double tap, a shaky finger): ignore it.
 * - Anywhere else: a new corner.
 */
export function classifyCornerTap(
  tap: GeoPoint,
  corners: GeoPoint[],
  zoom: number,
  closeRadius: number = CLOSE_RING_RADIUS_PT,
  duplicateRadius: number = DUPLICATE_CORNER_PT,
): CornerTap {
  if (corners.length) {
    const at = projectToWorld(tap, zoom);
    if (corners.length >= MIN_CORNERS) {
      const first = projectToWorld(corners[0], zoom);
      if (Math.hypot(at.x - first.x, at.y - first.y) <= closeRadius) return { action: 'close' };
    }
    const last = projectToWorld(corners[corners.length - 1], zoom);
    if (Math.hypot(at.x - last.x, at.y - last.y) <= duplicateRadius) return { action: 'ignore' };
  }
  return { action: 'add', point: { latitude: tap.latitude, longitude: tap.longitude } };
}

/** Plain-English line for the drawing bar. */
export function cornerProgressMessage(count: number): string {
  if (count === 0) return 'Tap the map to place the first corner.';
  if (count < MIN_CORNERS) {
    const more = MIN_CORNERS - count;
    return `${count} ${count === 1 ? 'corner' : 'corners'} so far. An outline needs at least ${MIN_CORNERS} — tap ${more} more ${more === 1 ? 'spot' : 'spots'}.`;
  }
  return `${count} corners. Keep tapping to add more, or tap the first corner or Done to finish.`;
}
