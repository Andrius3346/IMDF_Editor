// Render IMDF features stored in IDB onto the map. Used by the wizard so
// the user can see the polygons they've drawn; the property panel uses the
// same source for click-to-edit selection.

import * as features from '../storage/features.js';

export const SOURCE_ID = 'imdf-features';

const LAYERS = [
  // Footprint — light gray fill + dark outline.
  {
    id: 'imdf-footprint-fill',
    type: 'fill',
    filter: ['==', ['get', 'feature_type'], 'footprint'],
    paint: { 'fill-color': '#888', 'fill-opacity': 0.15 },
  },
  {
    id: 'imdf-footprint-line',
    type: 'line',
    filter: ['==', ['get', 'feature_type'], 'footprint'],
    paint: { 'line-color': '#333', 'line-width': 2 },
  },
  // Level — translucent fill, distinct color per active vs. inactive.
  {
    id: 'imdf-level-fill',
    type: 'fill',
    filter: ['==', ['get', 'feature_type'], 'level'],
    paint: {
      'fill-color': ['case', ['get', 'is_active'], '#4a90e2', '#888'],
      'fill-opacity': ['case', ['get', 'is_active'], 0.12, 0.05],
    },
  },
  {
    id: 'imdf-level-line',
    type: 'line',
    filter: ['==', ['get', 'feature_type'], 'level'],
    paint: {
      'line-color': ['case', ['get', 'is_active'], '#3a7ac2', '#666'],
      'line-width': ['case', ['get', 'is_active'], 2, 1],
    },
  },
  // Unit — semi-transparent fill, outlined.
  {
    id: 'imdf-unit-fill',
    type: 'fill',
    filter: ['==', ['get', 'feature_type'], 'unit'],
    paint: {
      'fill-color': '#f5b342',
      'fill-opacity': ['case', ['get', 'is_active'], 0.4, 0.1],
    },
  },
  {
    id: 'imdf-unit-line',
    type: 'line',
    filter: ['==', ['get', 'feature_type'], 'unit'],
    paint: {
      'line-color': '#a06a10',
      'line-width': ['case', ['get', 'is_active'], 1.5, 0.6],
      'line-opacity': ['case', ['get', 'is_active'], 1, 0.5],
    },
  },
  // Venue — outline-only, dashed.
  {
    id: 'imdf-venue-line',
    type: 'line',
    filter: ['==', ['get', 'feature_type'], 'venue'],
    paint: {
      'line-color': '#4a90e2',
      'line-width': 1.5,
      'line-dasharray': [3, 2],
    },
  },
  // Selection outline — drawn last (on top), keyed off is_selected.
  {
    id: 'imdf-selection-line',
    type: 'line',
    filter: ['==', ['get', 'is_selected'], true],
    paint: {
      'line-color': '#22c',
      'line-width': 3,
    },
  },
  {
    id: 'imdf-selection-point',
    type: 'circle',
    filter: ['all',
      ['==', ['get', 'is_selected'], true],
      ['==', ['geometry-type'], 'Point'],
    ],
    paint: {
      'circle-radius': 9,
      'circle-color': 'transparent',
      'circle-stroke-color': '#22c',
      'circle-stroke-width': 3,
    },
  },
];

let activeLevelId = null;
let selectedFeatureId = null;
// Cached rows from the last refreshFeaturesLayer() call. Selection / active-
// level toggles only flip per-feature booleans, so they reuse the cache and
// rebuild the FeatureCollection synchronously instead of round-tripping IDB.
// Any IDB write path that needs the new state visible already calls
// refreshFeaturesLayer afterwards (see main.js refreshAll), which refreshes
// the cache.
let cachedRows = null;

export function mountFeaturesLayer(map) {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  for (const spec of LAYERS) {
    map.addLayer({ ...spec, source: SOURCE_ID });
  }
}

/**
 * Re-read all features from IDB and update the GeoJSON source. Call after
 * every wizard write so the user sees their work on the map.
 */
export async function refreshFeaturesLayer(map) {
  if (!map.getSource(SOURCE_ID)) return;
  cachedRows = await features.all();
  applyCachedRows(map);
}

/**
 * Push the currently cached rows to the GeoJSON source. Used by the cheap
 * selection / active-level setters — no IDB hit.
 */
function applyCachedRows(map) {
  if (!map.getSource(SOURCE_ID)) return;
  const rows = cachedRows ?? [];
  const fc = {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => r.geometry)
      .map((r) => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          id: r.id,
          feature_type: r.feature_type,
          level_id: r.level_id ?? null,
          is_active: isActive(r),
          is_selected: r.id === selectedFeatureId,
        },
      })),
  };
  map.getSource(SOURCE_ID).setData(fc);
  // Raster overlays are added later than the features layer, so push our
  // layers back on top after every refresh. Otherwise newly mounted floor
  // PNGs cover the polygons the user just drew.
  for (const spec of LAYERS) {
    if (map.getLayer(spec.id)) map.moveLayer(spec.id);
  }
}

function isActive(row) {
  if (activeLevelId === null) return true;
  if (row.feature_type === 'level') return row.id === activeLevelId;
  if (row.feature_type === 'unit') return row.level_id === activeLevelId;
  return true; // footprint / venue / address always render at full opacity
}

/**
 * Set the floor the user is currently authoring. Units on other floors
 * dim out so the active floor stands out. Pass `null` to disable dimming.
 */
export function setActiveLevel(map, levelId) {
  activeLevelId = levelId;
  if (cachedRows) applyCachedRows(map);
  else refreshFeaturesLayer(map);
}

export function getActiveLevel() {
  return activeLevelId;
}

/**
 * Mark a feature as selected — adds a thick outline so the user sees what
 * the property panel is editing. Pass `null` to clear.
 */
export function setSelectedFeature(map, featureId) {
  selectedFeatureId = featureId;
  if (cachedRows) applyCachedRows(map);
  else refreshFeaturesLayer(map);
}

export function getSelectedFeature() {
  return selectedFeatureId;
}
