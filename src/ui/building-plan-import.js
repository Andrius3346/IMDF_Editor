// "Add building plan" button → file picker → rasterize → store → mount → edit.
//
// The user picks a PDF or TIFF, sees it appear on the map at the current
// view (or at the GeoTIFF's declared bounds if available), and is dropped
// straight into an edit session — OsmInEdit-style.

import * as rasters from '../storage/rasters.js';
import { rasterize as rasterizePdf } from '../raster/render-pdf.js';
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

async function importBuildingPlan(file, { map, refreshAll }) {
  const { blob, width, height } = await rasterizePdf(file);

  const corners = initialCornersForCanvas(map, width, height);
  const { gcps, transform, bounds } = rowFromCorners(corners, width, height);
  const z_order = await nextZOrder();

  const row = await rasters.create({
    name: file.name || `Building plan ${new Date().toISOString()}`,
    source_format: 'pdf',
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
    onCommit: () => refreshAll?.(),
    onCancel: () => refreshAll?.(),
  });
}

async function nextZOrder() {
  const list = await rasters.listMeta();
  if (!list.length) return 0;
  return list.reduce((max, r) => Math.max(max, r.z_order ?? 0), -1) + 1;
}
