// Compute display_point for IMDF features at export time.
//
// The IMDF spec requires display_point on every feature except address and
// relationship. The editor only sets it for venue (at wizard creation), so
// building/level/unit/footprint features arrive at the export step missing
// the property — or with a stale value if their geometry was edited.
//
// This module computes a fresh display_point per export. IndexedDB is never
// mutated; the result is injected into the exported GeoJSON only.
//
// Algorithm:
//   1. Centroid via polygonCentroid (shared with the wizard).
//   2. If the centroid falls inside the outer ring, use it.
//   3. Otherwise fall back to a horizontal-scanline midpoint — guaranteed
//      inside, deterministic, ~30 lines instead of pulling in polylabel.
//
// Buildings have null geometry in this codebase; the caller resolves them via
// `buildFootprintByBuildingIndex` and then runs `computeExportDisplayPoint`
// against the resolved footprint's geometry.

import { polygonCentroid } from '../ui/wizard/geom-utils.js';

/**
 * Ray casting on a single outer ring. Holes are ignored — IMDF features
 * rarely use them, and a centroid that lands inside a hole is still inside
 * the feature's footprint for label-placement purposes.
 *
 * @param {[number, number]} pt
 * @param {Array<[number, number]>} ring
 * @returns {boolean}
 */
export function pointInPolygon(pt, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Signed area of a ring via the shoelace formula. Positive for CCW, negative
 * for CW. Used to pick the dominant part of a MultiPolygon.
 *
 * @param {Array<[number, number]>} ring
 * @returns {number}
 */
export function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * Pick a point guaranteed to be inside the polygon. Strategy: at y = centroid.y,
 * intersect every edge, sort the intersection x-values, pair them into inside
 * segments, return the midpoint of the longest segment.
 *
 * @param {Array<[number, number]>} ring
 * @returns {[number, number] | null}
 */
export function pointOnSurface(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const [, cy] = polygonCentroid(ring);

  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Skip horizontal edges (yi === yj) and edges that don't straddle cy.
    if ((yi > cy) === (yj > cy)) continue;
    if (yi === yj) continue;
    const x = xi + ((cy - yi) * (xj - xi)) / (yj - yi);
    xs.push(x);
  }

  if (xs.length < 2) {
    // Degenerate scanline (shouldn't happen for a valid polygon). Fall back to
    // the midpoint of the first edge — guaranteed on the boundary, which the
    // spec accepts.
    const [x0, y0] = ring[0];
    const [x1, y1] = ring[1];
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  xs.sort((a, b) => a - b);
  let bestMid = null;
  let bestLen = -Infinity;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const len = xs[i + 1] - xs[i];
    if (len > bestLen) {
      bestLen = len;
      bestMid = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return bestMid === null ? null : [bestMid, cy];
}

/**
 * Pull out a single outer ring for centroid + containment work.
 * MultiPolygons return the outer ring of the part with the largest absolute
 * area, matching how renderers pick the dominant part for labels.
 *
 * @param {object|null|undefined} geometry
 * @returns {Array<[number, number]> | null}
 */
export function extractOuterRing(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates?.[0];
    return Array.isArray(ring) ? ring : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const parts = geometry.coordinates;
    if (!Array.isArray(parts) || parts.length === 0) return null;
    let best = null;
    let bestArea = -Infinity;
    for (const part of parts) {
      const ring = part?.[0];
      if (!Array.isArray(ring)) continue;
      const a = Math.abs(ringArea(ring));
      if (a > bestArea) {
        bestArea = a;
        best = ring;
      }
    }
    return best;
  }
  return null;
}

/**
 * Compute the display_point for a geometry. Returns the GeoJSON Point shape
 * IMDF expects, or null when no usable point can be derived (null geometry,
 * non-polygon geometry, degenerate ring).
 *
 * @param {object|null|undefined} geometry
 * @returns {{ type: 'Point', coordinates: [number, number] } | null}
 */
export function computeExportDisplayPoint(geometry) {
  const ring = extractOuterRing(geometry);
  if (!ring || ring.length < 3) return null;

  const centroid = polygonCentroid(ring);
  // polygonCentroid returns [0,0] for degenerate rings. Treat that as "no
  // display_point" — a real polygon centered exactly at lng=0,lat=0 (Gulf of
  // Guinea) would also be rejected, which is acceptable for IMDF use.
  if (centroid[0] === 0 && centroid[1] === 0) return null;

  if (pointInPolygon(centroid, ring)) {
    return { type: 'Point', coordinates: centroid };
  }
  const surface = pointOnSurface(ring);
  return surface ? { type: 'Point', coordinates: surface } : null;
}

/**
 * Index footprints by building id so callers can resolve a building's
 * display_point via its associated footprint geometry. A ground footprint
 * upgrades a previously-stored non-ground entry; a second ground footprint
 * does NOT displace the first (stable choice).
 *
 * @param {Array<{ id: string, properties?: { building_ids?: string[], category?: string }, geometry?: object|null }>} footprintRows
 * @returns {Map<string, object>}
 */
export function buildFootprintByBuildingIndex(footprintRows) {
  const index = new Map();
  if (!Array.isArray(footprintRows)) return index;
  for (const row of footprintRows) {
    const ids = row?.properties?.building_ids;
    if (!Array.isArray(ids)) continue;
    const isGround = row.properties?.category === 'ground';
    for (const id of ids) {
      const existing = index.get(id);
      if (!existing) {
        index.set(id, row);
        continue;
      }
      if (isGround && existing.properties?.category !== 'ground') {
        index.set(id, row);
      }
    }
  }
  return index;
}
