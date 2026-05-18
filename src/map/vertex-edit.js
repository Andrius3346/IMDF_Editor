// Vertex-edit session for a single polygon. Imports the polygon into Geoman's
// gm_main source, enables the 'change' edit mode plus shape_markers + snapping
// helpers, and streams the live geometry to a caller-supplied callback on
// every rAF tick. Used by both the post-creation property panel (Save commits
// on form submit) and the wizard's click-to-edit handler (commit on click-away).
//
// Snap targets: Geoman's snapping helper only sees features that already live
// in gm_main, so callers pass the geometries of nearby features they want to
// snap to and we import them for the lifetime of the session. They are removed
// again on end() so the next session starts clean.
//
// See src/map/draw.js for the same snap-target pattern used during freehand draws.
// See src/map/geoman.js for the API surface notes (free build, v0.7.x).
//
// Returns null if the input geometry is not a Polygon / MultiPolygon, or if
// Geoman is unavailable / rejects the import.

import {
  addPolygonFeature, removePolygonFeature, selectFeature, clearSelection,
  setEditMode, setShapeMarkers, setClickToSelectEnabled,
} from './geoman.js';

/**
 * @param {object} map MapLibre map with Geoman attached.
 * @param {object} opts
 * @param {object} opts.geometry GeoJSON Polygon or MultiPolygon to edit.
 * @param {(geom: object) => void} [opts.onLiveGeometry]
 *        Invoked on every rAF tick the geometry changes. Caller uses this to
 *        mutate row state and call patchCachedFeatureGeometry so the IMDF
 *        layer follows the live edits without an IDB write per frame.
 * @param {Array<{type:string, coordinates:any}>} [opts.snapTargets=[]]
 *        Geometries of nearby features to import as snap anchors.
 * @returns {Promise<{getLive: () => object, end: () => Promise<void>} | null>}
 */
export async function startVertexEditSession(map, { geometry, onLiveGeometry, snapTargets = [] } = {}) {
  if (!geometry) return null;
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return null;
  if (!map?.gm) return null;

  let featureData;
  try {
    featureData = await addPolygonFeature(map, {
      type: 'Feature', properties: {}, geometry,
    });
  } catch (err) {
    console.warn('Vertex edit session: import failed', err);
    return null;
  }

  // Snap-target imports happen after the editable polygon so that the
  // selection / shape_markers we enable below land on the right feature.
  const snapFeatures = [];
  for (const target of snapTargets) {
    if (!target?.coordinates) continue;
    if (target.type !== 'Polygon' && target.type !== 'MultiPolygon') continue;
    try {
      const fd = await addPolygonFeature(map, {
        type: 'Feature', properties: {}, geometry: target,
      });
      if (fd) snapFeatures.push(fd);
    } catch (err) {
      console.warn('Vertex edit session: snap target import failed', err);
    }
  }

  selectFeature(map, featureData.id);
  // Block Geoman's own click-to-select so a background click doesn't drop
  // selection halfway through the user's drag.
  setClickToSelectEnabled(false);
  await setShapeMarkers(map, true);
  await setEditMode(map, 'change');
  try {
    if (!map.gm.options.isModeEnabled?.('helper', 'snapping')) {
      await map.gm.options.enableMode('helper', 'snapping');
    }
  } catch { /* helper not present in this build — proceed without */ }

  let liveGeometry = geometry;
  let rafId = 0;
  let ended = false;

  const readGeometry = () => {
    try { return featureData.getGeoJson()?.geometry ?? null; }
    catch { return null; }
  };

  const syncFromFeature = () => {
    if (ended) return;
    const next = readGeometry();
    if (!next) return;
    if (geometriesEqual(next, liveGeometry)) return;
    liveGeometry = next;
    try { onLiveGeometry?.(next); }
    catch (err) { console.warn('Vertex edit session: onLiveGeometry threw', err); }
  };

  const tick = () => {
    if (ended) { rafId = 0; return; }
    syncFromFeature();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // Safety-net final settle in case the rAF was preempted by gm:changeend.
  const onChangeEnd = () => syncFromFeature();
  map.on('gm:changeend', onChangeEnd);

  return {
    getLive: () => { syncFromFeature(); return liveGeometry; },
    end: async () => {
      if (ended) return;
      ended = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      map.off('gm:changeend', onChangeEnd);
      await setEditMode(map, null);
      await setShapeMarkers(map, false);
      clearSelection(map);
      await removePolygonFeature(map, featureData);
      for (const fd of snapFeatures) {
        await removePolygonFeature(map, fd);
      }
      setClickToSelectEnabled(true);
    },
  };
}

function geometriesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  return JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates);
}
