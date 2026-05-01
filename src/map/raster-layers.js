// MapLibre image source / raster layer lifecycle, one per overlay row.
// The image is the display_blob (a PNG); the four lng/lat corners come from
// the row's GCPs (or its bounds, for axis-aligned legacy rows).

import * as rasters from '../storage/rasters.js';
import { cornersFromRow, cornersFromBounds } from '../raster/affine.js';

const blobUrls = new Map(); // id -> blob URL (so we can revoke on unmount)

function sourceId(id) { return `raster:${id}`; }
function layerId(id)  { return `raster:${id}`; }

export async function mountOverlay(map, row) {
  if (!row) return;
  if (map.getSource(sourceId(row.id))) return; // already mounted

  const blob = row.display_blob ?? await rasters.getDisplayBlob(row.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  blobUrls.set(row.id, url);

  const corners = cornersFromRow(row) ?? cornersFromBounds(row.bounds ?? [-1, -1, 1, 1]);

  map.addSource(sourceId(row.id), {
    type: 'image',
    url,
    coordinates: corners,
  });

  map.addLayer({
    id: layerId(row.id),
    type: 'raster',
    source: sourceId(row.id),
    paint: {
      'raster-opacity': row.opacity ?? 1,
      'raster-fade-duration': 0,
    },
    layout: {
      visibility: row.visible === false ? 'none' : 'visible',
    },
  });
}

export function unmountOverlay(map, id) {
  if (map.getLayer(layerId(id))) map.removeLayer(layerId(id));
  if (map.getSource(sourceId(id))) map.removeSource(sourceId(id));
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
}

export function unmountAllOverlays(map) {
  for (const id of Array.from(blobUrls.keys())) unmountOverlay(map, id);
}

export function setOverlayCoordinates(map, id, corners) {
  const src = map.getSource(sourceId(id));
  if (src && typeof src.setCoordinates === 'function') src.setCoordinates(corners);
}

export function setOverlayOpacity(map, id, value) {
  if (map.getLayer(layerId(id))) {
    map.setPaintProperty(layerId(id), 'raster-opacity', value);
  }
}

export function setOverlayVisibility(map, id, visible) {
  if (map.getLayer(layerId(id))) {
    map.setLayoutProperty(layerId(id), 'visibility', visible ? 'visible' : 'none');
  }
}

/**
 * Move the overlay's raster layer above another overlay, or to the top if
 * `beforeId` is null. Layer ids are derived from overlay ids.
 */
export function setOverlayOrder(map, id, beforeId = null) {
  const lid = layerId(id);
  if (!map.getLayer(lid)) return;
  const before = beforeId ? layerId(beforeId) : undefined;
  map.moveLayer(lid, before);
}

export function getLayerId(id) { return layerId(id); }
export function isOverlayMounted(map, id) { return !!map.getSource(sourceId(id)); }
