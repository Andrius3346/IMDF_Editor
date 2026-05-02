// "Add building plan" button → file picker → store → mount → edit.
//
// The user picks a PNG, sees it appear on the map at the current view, and
// is dropped straight into an edit session — OsmInEdit-style.

import * as rasters from '../storage/rasters.js';
import { rasterize as readPng } from '../raster/render-png.js';
import { initialCornersForCanvas, rowFromCorners } from '../raster/affine.js';
import { mountOverlay } from '../map/raster-layers.js';
import { startEditSession } from './georeference.js';

const $ = (id) => document.getElementById(id);

export function mountBuildingPlanImport({ map, refreshAll }) {
  const btn = $('add-building-plan-btn');
  const input = $('building-plan-input');
  if (!btn || !input) return;

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Loading…';
    try {
      await importBuildingPlan(file, { map, refreshAll });
    } catch (err) {
      console.error('Building plan import failed:', err);
      alert(`Couldn't load building plan: ${err.message}`);
    } finally {
      btn.textContent = originalLabel;
      btn.disabled = false;
    }
  });
}

/**
 * Read + persist a PNG, mount it on the map, and start a georef edit
 * session. Exported so the creation wizard can drive it directly with
 * custom commit/cancel callbacks. Pass `name` to label the overlay by
 * its purpose (e.g. "Ground floor"); otherwise the file name is used.
 * Returns the persisted raster row (synchronously after creation;
 * callbacks fire later when the user clicks Done/Cancel in the georef
 * toolbar).
 */
export async function importBuildingPlan(file, { map, refreshAll, onCommit, onCancel, name } = {}) {
  const { blob, width, height } = await readPng(file);

  const corners = initialCornersForCanvas(map, width, height);
  const { gcps, transform, bounds } = rowFromCorners(corners, width, height);
  const z_order = await nextZOrder();

  const row = await rasters.create({
    name: name || file.name || `Building plan ${new Date().toISOString()}`,
    source_format: 'png',
    source_blob: file,
    display_blob: blob,
    gcps, transform, bounds,
    opacity: 0.85, // slightly translucent so footprint is visible underneath
    visible: true,
    z_order,
  });

  await mountOverlay(map, row);
  await refreshAll?.();

  await startEditSession({
    map, row, imgW: width, imgH: height,
    onCommit: (updated) => {
      refreshAll?.();
      onCommit?.(updated ?? row);
    },
    onCancel: () => {
      refreshAll?.();
      onCancel?.();
    },
  });

  return row;
}

async function nextZOrder() {
  const list = await rasters.listMeta();
  if (!list.length) return 0;
  return list.reduce((max, r) => Math.max(max, r.z_order ?? 0), -1) + 1;
}
