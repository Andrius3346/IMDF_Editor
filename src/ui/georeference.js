// One-overlay-at-a-time georeferencing edit session.
//
// Builds a Geoman polygon over the four image corners, programmatically
// selects it, then enables drag / rotate / change as the user toggles the
// floating toolbar. Real-time sync to the MapLibre image source uses a
// requestAnimationFrame loop bracketed by Geoman's *start / *end events,
// since the free build doesn't emit a continuous "during" event.

import * as rasters from '../storage/rasters.js';
import {
  setOverlayCoordinates, setOverlayOpacity,
} from '../map/raster-layers.js';
import {
  addPolygonFeature, removePolygonFeature, selectFeature, clearSelection,
  setEditMode, setShapeMarkers, setClickToSelectEnabled,
} from '../map/geoman.js';
import { cornersFromRow, rowFromCorners } from '../raster/affine.js';

let active = null; // single-session lock

const $ = (id) => document.getElementById(id);

// HTML toolbar mode buttons (data-mode) -> Geoman edit mode names.
// 'scale' is intentionally absent: Geoman free's editClassMap.scale is null
// (Pro-only). We implement uniform scale ourselves with a slider.
const MODE_MAP = {
  drag: 'drag',
  rotate: 'rotate',
  edit: 'change',     // toolbar says "Resize"; Geoman calls it "change"
};

export async function startEditSession({ map, row, imgW, imgH, onCommit, onCancel }) {
  if (active) await endActiveSession({ commit: false });

  const startCorners = cornersFromRow(row);
  if (!startCorners) {
    console.warn('georeference: row has no corners', row);
    return;
  }

  const polygonGeo = polygonFromCorners(startCorners);
  const featureData = await addPolygonFeature(map, polygonGeo);
  selectFeature(map, featureData.id);
  setClickToSelectEnabled(false); // background clicks shouldn't clear the selection
  await setShapeMarkers(map, true);

  const session = {
    map,
    rowId: row.id,
    imgW, imgH,
    startCorners: startCorners.map((p) => p.slice()),
    startOpacity: row.opacity ?? 1,
    currentCorners: startCorners.map((p) => p.slice()),
    currentOpacity: row.opacity ?? 1,
    featureData,
    onCommit, onCancel,
    rafId: 0,
  };
  active = session;

  // Continuous rAF poll while the session is open. Reading a small JS object
  // each frame is cheap and avoids guessing which Geoman start/end events
  // fire for which mode (change/scale don't always emit the *start/*end pair
  // we'd need to bracket the loop).
  const pump = () => {
    session.rafId = 0;
    if (active !== session) return;
    const corners = readCorners(session.featureData);
    if (corners && cornersChanged(corners, session.currentCorners)) {
      session.currentCorners = corners;
      setOverlayCoordinates(session.map, session.rowId, corners);
    }
    session.rafId = requestAnimationFrame(pump);
  };
  session.rafId = requestAnimationFrame(pump);

  // Toolbar wiring.
  showToolbar(row.name);
  setActiveModeButton('drag');
  await setEditMode(map, 'drag');

  for (const btn of document.querySelectorAll('#georef-toolbar .modes button')) {
    btn.onclick = async () => {
      const uiMode = btn.dataset.mode;
      setActiveModeButton(uiMode);
      if (uiMode === 'scale') {
        // Custom scale (Geoman free has no scale mode).
        await setEditMode(map, null);
        enterScaleMode(session);
      } else {
        exitScaleMode(session);
        const gmMode = MODE_MAP[uiMode];
        await setEditMode(map, gmMode);
        // Re-select after a mode switch — some modes implicitly clear selection.
        selectFeature(map, session.featureData.id);
      }
    };
  }

  // Custom scale slider wiring.
  const scaleInput = $('georef-scale');
  const scaleVal = $('georef-scale-val');
  const scaleReset = $('georef-scale-reset');
  scaleInput.oninput = () => {
    if (!session.scaleAnchor) return;
    const factor = Number(scaleInput.value);
    scaleVal.textContent = `${Math.round(factor * 100)}%`;
    applyScale(session, factor);
  };
  scaleReset.onclick = () => {
    scaleInput.value = '1';
    scaleVal.textContent = '100%';
    applyScale(session, 1);
  };

  const opacityInput = $('georef-opacity');
  const opacityVal = $('georef-opacity-val');
  opacityInput.value = String(session.currentOpacity);
  opacityVal.textContent = `${Math.round(session.currentOpacity * 100)}%`;
  opacityInput.oninput = () => {
    const v = Number(opacityInput.value);
    session.currentOpacity = v;
    opacityVal.textContent = `${Math.round(v * 100)}%`;
    setOverlayOpacity(map, row.id, v);
  };

  $('georef-done').onclick = () => endActiveSession({ commit: true });
  $('georef-cancel').onclick = () => endActiveSession({ commit: false });
}

export async function endActiveSession({ commit }) {
  const s = active;
  if (!s) return;
  active = null;

  if (s.rafId) cancelAnimationFrame(s.rafId);
  await setEditMode(s.map, null);
  await setShapeMarkers(s.map, false);
  clearSelection(s.map);
  await removePolygonFeature(s.map, s.featureData);
  setClickToSelectEnabled(true);
  hideToolbar();

  if (commit) {
    const { gcps, transform, bounds } = rowFromCorners(s.currentCorners, s.imgW, s.imgH);
    const updated = await rasters.update(s.rowId, {
      gcps, transform, bounds, opacity: s.currentOpacity,
    });
    setOverlayCoordinates(s.map, s.rowId, s.currentCorners);
    s.onCommit?.(updated);
  } else {
    setOverlayCoordinates(s.map, s.rowId, s.startCorners);
    setOverlayOpacity(s.map, s.rowId, s.startOpacity);
    s.onCancel?.();
  }
}

export function isEditing() { return !!active; }
export function getActiveOverlayId() { return active?.rowId ?? null; }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Snapshot the current corners + their pixel-space center so subsequent
 * slider movements scale uniformly relative to that anchor. Re-snapshotting
 * on every entry makes the slider always start from the current state.
 */
function enterScaleMode(session) {
  const corners = session.currentCorners.map((p) => p.slice());
  const center = polygonCenter(corners);
  session.scaleAnchor = {
    corners,
    centerPx: session.map.project(center),
  };
  const scaleRow = $('georef-scale-row');
  if (scaleRow) scaleRow.hidden = false;
  const input = $('georef-scale');
  const val = $('georef-scale-val');
  if (input) input.value = '1';
  if (val) val.textContent = '100%';
}

function exitScaleMode(session) {
  session.scaleAnchor = null;
  const scaleRow = $('georef-scale-row');
  if (scaleRow) scaleRow.hidden = true;
}

/**
 * Scale the snapshotted anchor corners around the snapshotted pixel center
 * by `factor`, then push the result both to the MapLibre image source (for
 * immediate feedback) and into the Geoman feature (so handles in other modes
 * align correctly when the user switches away from Scale).
 *
 * Working in pixel space avoids Mercator distortion at the current latitude
 * — at Vilnius (~54.6°N) a uniform lng/lat scale would visibly stretch.
 */
function applyScale(session, factor) {
  const anchor = session.scaleAnchor;
  if (!anchor) return;
  const { corners, centerPx } = anchor;
  const map = session.map;
  const newCorners = corners.map(([lng, lat]) => {
    const px = map.project([lng, lat]);
    const dx = (px.x - centerPx.x) * factor;
    const dy = (px.y - centerPx.y) * factor;
    const ll = map.unproject([centerPx.x + dx, centerPx.y + dy]);
    return [ll.lng, ll.lat];
  });
  session.currentCorners = newCorners;
  setOverlayCoordinates(map, session.rowId, newCorners);
  // Keep the Geoman polygon in sync so the stroke outline tracks the scaled
  // raster and other modes resume from the right shape.
  const ring = [...newCorners.map((c) => c.slice()), newCorners[0].slice()];
  session.featureData?.updateGeometry?.({ type: 'Polygon', coordinates: [ring] }).catch(() => {});
}

function polygonCenter(corners) {
  let lng = 0, lat = 0;
  for (const [x, y] of corners) { lng += x; lat += y; }
  return [lng / corners.length, lat / corners.length];
}

function readCorners(featureData) {
  if (!featureData?.getGeoJson) return null;
  let gj;
  try { gj = featureData.getGeoJson(); } catch { return null; }
  const ring = gj?.geometry?.coordinates?.[0];
  return take4(ring);
}

function showToolbar(title) {
  const t = $('georef-toolbar');
  if (!t) return;
  $('georef-title').textContent = title ? `Georeference — ${title}` : 'Georeference';
  t.hidden = false;
  const scaleRow = $('georef-scale-row');
  if (scaleRow) scaleRow.hidden = true;
}

function hideToolbar() {
  const t = $('georef-toolbar');
  if (t) t.hidden = true;
  for (const btn of document.querySelectorAll('#georef-toolbar .modes button')) {
    btn.classList.remove('active');
  }
  const scaleRow = $('georef-scale-row');
  if (scaleRow) scaleRow.hidden = true;
}

function setActiveModeButton(uiMode) {
  for (const btn of document.querySelectorAll('#georef-toolbar .modes button')) {
    btn.classList.toggle('active', btn.dataset.mode === uiMode);
  }
}

function polygonFromCorners(corners) {
  const ring = [...corners.map((p) => [p[0], p[1]]), [corners[0][0], corners[0][1]]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function cornersChanged(a, b) {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return true;
  }
  return false;
}

function take4(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const last = ring[ring.length - 1];
  const first = ring[0];
  const trimmed = (last[0] === first[0] && last[1] === first[1]) ? ring.slice(0, -1) : ring;
  if (trimmed.length < 4) return null;
  return [trimmed[0], trimmed[1], trimmed[2], trimmed[3]].map((p) => [p[0], p[1]]);
}
