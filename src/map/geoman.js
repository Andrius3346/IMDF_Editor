// Wrapper around @geoman-io/maplibre-geoman-free.
//
// Verified API surface (free v0.7.x):
//   new Geoman(map, options)                              — async init; emits 'gm:loaded'
//   geoman.features.importGeoJsonFeature(feature)         — async; returns FeatureData|null
//   geoman.features.delete(featureIdOrFeatureData)        — async
//   geoman.features.setSelection([featureId])             — programmatic selection
//   geoman.features.clearSelection()
//   geoman.options.enableMode(modeType, modeName)         — async
//   geoman.options.disableMode(modeType, modeName)        — async
//   geoman.options.isModeEnabled(modeType, modeName)
//
// Mode types: 'draw' | 'edit' | 'helper'
// Edit modes:  'drag' | 'rotate' | 'change' | 'scale' | ...
// Helper modes: 'shape_markers' (handles visibility) | 'snapping' | ...
// FREE LIMITATION: 'click_to_edit' helper is Pro-only — installClickToSelect()
// below replicates it by querying rendered features in the gm_main source.
//
// Forwarded edit events on the map:
//   gm:dragstart   gm:dragend
//   gm:rotatestart gm:rotateend
//   gm:changestart gm:changeend
// (No continuous "during" event in the public stream — use rAF polling
//  on the FeatureData between start/end if you need live geometry.)

import { Geoman } from 'https://esm.sh/@geoman-io/maplibre-geoman-free?deps=maplibre-gl@4';

const GM_MAIN_SOURCE = 'gm_main';
const GM_FEATURE_ID_PROP = '__gm_id';

let clickToSelectEnabled = true;

export async function attachGeoman(map) {
  const geoman = new Geoman(map, {
    settings: { throttlingDelay: 0 },
  });

  await new Promise((resolve) => {
    if (map.gm) { resolve(); return; }
    map.once('gm:loaded', () => resolve());
  });

  installClickToSelect(map);
  hideGeomanPolygonFill(map);
  return geoman;
}

/**
 * Make Geoman's polygon fill transparent across all gm_* sources, while
 * leaving the stroke (line layer) intact. The georeferencing overlay
 * polygon would otherwise paint a blue rectangle over the building plan.
 *
 * Re-applied on every styledata event so layers added later (e.g. when
 * Geoman re-creates layers on mode switches) stay transparent too.
 */
function hideGeomanPolygonFill(map) {
  const apply = () => {
    const layers = map.getStyle()?.layers ?? [];
    for (const l of layers) {
      if (l.type !== 'fill') continue;
      const src = typeof l.source === 'string' ? l.source : null;
      if (!src || !src.startsWith('gm_')) continue;
      try { map.setPaintProperty(l.id, 'fill-opacity', 0); } catch { /* ignore */ }
    }
  };
  apply();
  map.on('styledata', apply);
}

/**
 * Add a feature to Geoman's main (editable) source. Returns the FeatureData
 * handle, which carries the id we use for selection / events / removal.
 */
export async function addPolygonFeature(map, geojson) {
  if (!map.gm?.features?.importGeoJsonFeature) {
    throw new Error('Geoman not ready: features.importGeoJsonFeature is unavailable');
  }
  const featureData = await map.gm.features.importGeoJsonFeature(geojson);
  if (!featureData) throw new Error('Geoman rejected the feature (unknown shape?)');
  return featureData;
}

export async function removePolygonFeature(map, featureData) {
  if (!featureData) return;
  try {
    if (typeof featureData.delete === 'function') {
      await featureData.delete();
      return;
    }
    if (map.gm?.features?.delete) {
      await map.gm.features.delete(featureData.id ?? featureData);
    }
  } catch (err) {
    console.warn('Geoman: remove feature failed', err);
  }
}

export function selectFeature(map, featureId) {
  try { map.gm?.features?.setSelection?.([featureId]); }
  catch (err) { console.warn('Geoman: setSelection failed', err); }
}

export function clearSelection(map) {
  try { map.gm?.features?.clearSelection?.(); }
  catch { /* ignore */ }
}

const EDIT_MODES = ['drag', 'rotate', 'change', 'scale'];

/**
 * Enable exactly one edit mode (drag | rotate | change | scale | null).
 */
export async function setEditMode(map, mode) {
  if (!map.gm?.options) return;
  for (const m of EDIT_MODES) {
    if (m === mode) continue;
    try {
      if (map.gm.options.isModeEnabled?.('edit', m)) {
        await map.gm.options.disableMode('edit', m);
      }
    } catch { /* version drift — ignore */ }
  }
  if (!mode) return;
  try {
    if (!map.gm.options.isModeEnabled?.('edit', mode)) {
      await map.gm.options.enableMode('edit', mode);
    }
  } catch (err) {
    console.warn('Geoman: enableMode failed', mode, err);
  }
}

/**
 * Toggle the shape_markers helper. While on, vertex/handle markers render
 * over selected features so the user has something to grab.
 */
export async function setShapeMarkers(map, enabled) {
  if (!map.gm?.options) return;
  try {
    const on = map.gm.options.isModeEnabled?.('helper', 'shape_markers');
    if (enabled && !on) await map.gm.options.enableMode('helper', 'shape_markers');
    else if (!enabled && on) await map.gm.options.disableMode('helper', 'shape_markers');
  } catch (err) {
    console.warn('Geoman: shape_markers toggle failed', err);
  }
}

/**
 * Replicate the (Pro-only) click_to_edit helper: on map click, find the
 * topmost Geoman-managed feature under the cursor and select it. Clicks
 * that miss everything clear the selection.
 *
 * Disabled while a per-overlay edit session is active (we don't want a stray
 * background click to clear the polygon we just selected programmatically).
 */
function installClickToSelect(map) {
  map.on('click', (ev) => {
    if (!clickToSelectEnabled) return;
    if (!map.gm?.features) return;
    const hits = map.queryRenderedFeatures(ev.point);
    const gmHit = hits.find((f) => isGeomanFeature(f));
    if (gmHit) {
      const id = gmHit.properties?.[GM_FEATURE_ID_PROP];
      if (id !== undefined && id !== null) {
        map.gm.features.setSelection?.([id]);
        return;
      }
    }
    // Clicked empty space — clear selection so the next mode toggle starts fresh.
    map.gm.features.clearSelection?.();
  });
}

function isGeomanFeature(f) {
  if (!f) return false;
  if (f.source === GM_MAIN_SOURCE) return true;
  if (typeof f.source === 'string' && f.source.startsWith('gm_')) return true;
  return false;
}

export function setClickToSelectEnabled(enabled) {
  clickToSelectEnabled = !!enabled;
}
