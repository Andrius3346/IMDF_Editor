// MapLibre map shell. Inline OSM raster style so the app works without an
// API key. Restores and persists the last viewport via the preferences store.

import maplibregl from 'https://esm.sh/maplibre-gl@4';
import * as preferences from '../storage/preferences.js';

const VIEWPORT_KEY = 'last_viewport';
// Vilnius University area — sensible first-run center for this project.
const DEFAULT_VIEW = { center: [25.2797, 54.6872], zoom: 13, bearing: 0, pitch: 0 };

// Esri World Imagery satellite basemap. Free to use with attribution; no
// API key required. The `glyphs` URL is required by Geoman for label rendering
// even though the satellite layer itself has no text.
const SATELLITE_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
  ],
};

export async function createMap(container) {
  const stored = await preferences.get(VIEWPORT_KEY).catch(() => null);
  const view = stored && typeof stored === 'object' ? { ...DEFAULT_VIEW, ...stored } : DEFAULT_VIEW;

  const map = new maplibregl.Map({
    container,
    style: SATELLITE_STYLE,
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing ?? 0,
    pitch: view.pitch ?? 0,
    hash: false,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

  let saveTimer = 0;
  map.on('moveend', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const c = map.getCenter();
      preferences.set(VIEWPORT_KEY, {
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }).catch(() => {});
    }, 400);
  });

  await new Promise((resolve) => {
    if (map.loaded()) resolve();
    else map.once('load', resolve);
  });

  return map;
}

export { maplibregl };
