// Lightweight geometry helpers for the wizard. No new dependencies.

/**
 * Centroid of a polygon's outer ring (ignores holes). Uses the standard
 * shoelace centroid formula. Returns [lng, lat]. Falls back to the
 * arithmetic mean for degenerate (zero-area) rings.
 */
export function polygonCentroid(coords) {
  const ring = coords?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return [0, 0];

  // Trim the closing point if the ring is closed.
  const pts = (ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1])
    ? ring.slice(0, -1)
    : ring;

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  if (twiceArea === 0) {
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    return [mx / pts.length, my / pts.length];
  }

  const sixArea = 3 * twiceArea;
  return [cx / sixArea, cy / sixArea];
}
