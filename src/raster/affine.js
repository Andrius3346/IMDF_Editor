// Pure helpers for converting between four lng/lat corners and the row's
// stored shape (gcps / transform / bounds). The map's image source always
// owns the live state as four [lng, lat] points in TL, TR, BR, BL order.
//
// `transform` is a 6-element affine [a, b, c, d, e, f] mapping pixel space
// (px = [x_pixels, y_pixels]) to lng/lat:
//   lng = a * px.x + b * px.y + e
//   lat = c * px.x + d * px.y + f

const CORNER_ORDER = ['tl', 'tr', 'br', 'bl'];

export function cornersFromBounds([w, s, e, n]) {
  return [[w, n], [e, n], [e, s], [w, s]];
}

/**
 * Recover image pixel dimensions from a row whose GCPs were created via
 * rowFromCorners (i.e. anchored at the canonical [0,0]/[W,0]/[W,H]/[0,H] pixels).
 * Returns null if the row doesn't carry usable GCPs.
 */
export function imgDimsFromRow(row) {
  const gcps = row?.gcps;
  if (!Array.isArray(gcps) || gcps.length < 3) return null;
  let maxX = 0, maxY = 0;
  for (const g of gcps) {
    if (!g?.px) continue;
    if (g.px[0] > maxX) maxX = g.px[0];
    if (g.px[1] > maxY) maxY = g.px[1];
  }
  if (maxX > 0 && maxY > 0) return { width: maxX, height: maxY };
  return null;
}

export function boundsFromCorners(corners) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of corners) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/**
 * Read the four image corners (TL, TR, BR, BL) from a stored row.
 * Prefers GCPs (which carry the actual quad even if the image is rotated/skewed)
 * and falls back to `bounds` for legacy rows that only stored an axis-aligned box.
 */
export function cornersFromRow(row) {
  if (Array.isArray(row.gcps) && row.gcps.length === 4) {
    const sorted = sortGcpsByPxOrder(row.gcps);
    if (sorted) return sorted.map((g) => lngLatToArray(g.lngLat));
  }
  if (Array.isArray(row.bounds) && row.bounds.length === 4) {
    return cornersFromBounds(row.bounds);
  }
  return null;
}

/**
 * Build the storable {gcps, transform, bounds} from four corners + image size.
 * GCPs are anchored to the canonical pixel corners of the image so re-loading
 * the row reproduces the same quad regardless of any future change to bounds.
 */
export function rowFromCorners(corners, imgW, imgH) {
  const [tl, tr, br, bl] = corners;
  const gcps = [
    { px: [0, 0],         lngLat: tl },
    { px: [imgW, 0],      lngLat: tr },
    { px: [imgW, imgH],   lngLat: br },
    { px: [0, imgH],      lngLat: bl },
  ];
  const transform = fitAffineFromGcps(gcps.slice(0, 3));
  const bounds = boundsFromCorners(corners);
  return { gcps, transform, bounds };
}

/**
 * Fit a 6-element affine [a, b, c, d, e, f] from three (px, lngLat) pairs.
 * Three pairs uniquely determine an affine; a fourth would over-constrain
 * for a non-affine quad, so we ignore it on purpose — the map keeps the
 * exact quadrilateral via the four corner coordinates.
 */
export function fitAffineFromGcps(gcps) {
  const [g0, g1, g2] = gcps;
  const [x0, y0] = g0.px;
  const [x1, y1] = g1.px;
  const [x2, y2] = g2.px;
  const [u0, v0] = lngLatToArray(g0.lngLat);
  const [u1, v1] = lngLatToArray(g1.lngLat);
  const [u2, v2] = lngLatToArray(g2.lngLat);

  // Solve [[x0,y0,1],[x1,y1,1],[x2,y2,1]] * [a;b;e] = [u0;u1;u2] (and same for c,d,f).
  const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-12) {
    // Degenerate (collinear) — fall back to identity-ish to avoid NaNs.
    return [1, 0, 0, 1, 0, 0];
  }
  const inv = 1 / det;
  // Inverse of the 3x3 matrix above.
  const m00 =  (y1 - y2) * inv;
  const m01 = -(y0 - y2) * inv;
  const m02 =  (y0 - y1) * inv;
  const m10 = -(x1 - x2) * inv;
  const m11 =  (x0 - x2) * inv;
  const m12 = -(x0 - x1) * inv;
  const m20 =  (x1 * y2 - x2 * y1) * inv;
  const m21 = -(x0 * y2 - x2 * y0) * inv;
  const m22 =  (x0 * y1 - x1 * y0) * inv;

  const a = m00 * u0 + m01 * u1 + m02 * u2;
  const b = m10 * u0 + m11 * u1 + m12 * u2;
  const e = m20 * u0 + m21 * u1 + m22 * u2;
  const c = m00 * v0 + m01 * v1 + m02 * v2;
  const d = m10 * v0 + m11 * v1 + m12 * v2;
  const f = m20 * v0 + m21 * v1 + m22 * v2;
  return [a, b, c, d, e, f];
}

/**
 * Pick an initial axis-aligned quad inside the current map view that matches
 * the image's aspect ratio, so the user immediately sees the whole plan.
 */
export function initialCornersForCanvas(map, imgW, imgH) {
  const b = map.getBounds();
  const w = b.getWest();
  const e = b.getEast();
  const s = b.getSouth();
  const n = b.getNorth();
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;

  // Inset to ~60% of viewport so handles are comfortable to grab.
  const halfW = (e - w) * 0.3;
  const halfH = (n - s) * 0.3;

  // Match image aspect ratio. Convert to a screen-pixel basis so the
  // overlay actually looks proportional regardless of latitude.
  const tlPx = map.project([cx - halfW, cy + halfH]);
  const brPx = map.project([cx + halfW, cy - halfH]);
  const viewWpx = Math.abs(brPx.x - tlPx.x);
  const viewHpx = Math.abs(brPx.y - tlPx.y);
  const imgAspect = imgW / imgH;
  const viewAspect = viewWpx / viewHpx;

  let pxW, pxH;
  if (imgAspect > viewAspect) { pxW = viewWpx; pxH = viewWpx / imgAspect; }
  else                        { pxH = viewHpx; pxW = viewHpx * imgAspect; }

  const centerPx = map.project([cx, cy]);
  const tl = map.unproject([centerPx.x - pxW / 2, centerPx.y - pxH / 2]);
  const tr = map.unproject([centerPx.x + pxW / 2, centerPx.y - pxH / 2]);
  const br = map.unproject([centerPx.x + pxW / 2, centerPx.y + pxH / 2]);
  const bl = map.unproject([centerPx.x - pxW / 2, centerPx.y + pxH / 2]);
  return [
    [tl.lng, tl.lat],
    [tr.lng, tr.lat],
    [br.lng, br.lat],
    [bl.lng, bl.lat],
  ];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lngLatToArray(ll) {
  if (Array.isArray(ll)) return [ll[0], ll[1]];
  if (ll && typeof ll === 'object') return [ll.lng, ll.lat];
  return [NaN, NaN];
}

/**
 * Reorder a 4-element GCP array into TL, TR, BR, BL by inspecting the px
 * coordinate of each entry — supports any insertion order so callers can
 * persist GCPs in whatever order they were created.
 */
function sortGcpsByPxOrder(gcps) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of gcps) {
    const [x, y] = g.px;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const buckets = { tl: null, tr: null, br: null, bl: null };
  for (const g of gcps) {
    const [x, y] = g.px;
    const top = closer(y, minY, maxY);
    const left = closer(x, minX, maxX);
    const key = (top ? 't' : 'b') + (left ? 'l' : 'r');
    if (buckets[key]) return null; // ambiguous mapping
    buckets[key] = g;
  }
  for (const k of CORNER_ORDER) if (!buckets[k]) return null;
  return CORNER_ORDER.map((k) => buckets[k]);
}

function closer(v, a, b) {
  return Math.abs(v - a) <= Math.abs(v - b);
}

export const __test__ = { sortGcpsByPxOrder };
