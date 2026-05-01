// MapLibre map shell. Inline OSM raster style so the app works without an
// API key. The editor is session-only, so the camera always starts at
// DEFAULT_VIEW — viewport is intentionally not restored across reloads.

import maplibregl from 'https://esm.sh/maplibre-gl@4';

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
  const map = new maplibregl.Map({
    container,
    style: SATELLITE_STYLE,
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    bearing: DEFAULT_VIEW.bearing,
    pitch: DEFAULT_VIEW.pitch,
    hash: false,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

  await new Promise((resolve) => {
    if (map.loaded()) resolve();
    else map.once('load', resolve);
  });

  return map;
}

export { maplibregl };
