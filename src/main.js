// Entry module. Wires the storage layer, the MapLibre map canvas, the
// Geoman edit handles, and the building-plan georeferencing UX to the
// index.html shell.

import * as features from './storage/features.js';
import * as rasters from './storage/rasters.js';
import * as manifestStore from './storage/manifest.js';
import * as preferences from './storage/preferences.js';
import { hasData, clearAll } from './storage/db.js';
import { importZip } from './io/zip-import.js';
import { downloadZip, buildZip } from './io/zip-export.js';

import { createMap } from './map/map.js';
import { attachGeoman } from './map/geoman.js';
import { mountOverlay, unmountAllOverlays } from './map/raster-layers.js';
import { mountBuildingPlanImport } from './ui/building-plan-import.js';
import { mountLayersPanel, refreshLayersPanel } from './ui/layers-panel.js';

const $ = (id) => document.getElementById(id);

let map = null;

async function refreshStoragePanel() {
  const persisted = await navigator.storage?.persisted?.();
  $('persisted').textContent = persisted ? 'yes' : 'no (browser may evict)';

  const est = await navigator.storage?.estimate?.();
  if (est && est.quota) {
    const used = formatBytes(est.usage ?? 0);
    const quota = formatBytes(est.quota);
    const pct = Math.min(100, ((est.usage ?? 0) / est.quota) * 100);
    $('usage').textContent = `${used} of ${quota} (${pct.toFixed(1)}%)`;
    $('usage-bar').style.width = `${pct}%`;
  } else {
    $('usage').textContent = 'unavailable';
  }
}

async function refreshSummary() {
  const manifest = await manifestStore.getManifest();
  const importedAt = await manifestStore.getImportedAt();
  const mapName = await manifestStore.getMapName();

  $('map-name').textContent = mapName ?? (manifest ? '(unnamed map)' : 'no map loaded');
  $('imported-at').textContent = importedAt ? new Date(importedAt).toLocaleString() : '—';
  $('manifest-version').textContent = manifest?.version ?? '—';
  $('manifest-language').textContent = manifest?.language ?? '—';

  const total = await features.count();
  $('feature-count').textContent = String(total);

  const overlays = await rasters.listMeta();
  $('raster-count').textContent = String(overlays.length);

  const counts = await Promise.all(
    features.FEATURE_TYPES.map(async (t) => [t, (await features.byType(t)).length]),
  );
  const tbody = $('type-counts').querySelector('tbody');
  tbody.innerHTML = counts
    .map(([t, n]) => `<tr><th>${t}</th><td>${n}</td></tr>`)
    .join('');
}

async function refreshAll() {
  await Promise.all([refreshStoragePanel(), refreshSummary()]);
  await refreshLayersPanel();
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function onImportClick() {
  if (await hasData()) {
    const ok = confirm(
      'Importing will replace the current map. Export first if you want to keep it.\n\nReplace now?',
    );
    if (!ok) return;
  }
  $('import-input').click();
}

async function onImportFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = ''; // allow re-picking the same file later
  if (!file) return;
  try {
    const result = await importZip(file, { mapName: file.name.replace(/\.zip$/i, '') });
    console.log('Imported:', result);
    if (result.warnings.length) console.warn('Import warnings:', result.warnings);
  } catch (e) {
    console.error('Import failed:', e);
    alert(`Import failed: ${e.message}`);
  } finally {
    await refreshAll();
  }
}

async function onExportClick() {
  try {
    const name = (await manifestStore.getMapName()) ?? 'imdf-map';
    const result = await downloadZip(`${name}.zip`);
    console.log('Exported:', result);
  } catch (e) {
    console.error('Export failed:', e);
    alert(`Export failed: ${e.message}`);
  }
}

async function onClearClick() {
  const ok = confirm('Clear all locally stored map data? This cannot be undone.');
  if (!ok) return;
  if (map) unmountAllOverlays(map);
  await clearAll();
  await refreshAll();
}

async function init() {
  // Persistent storage matters here — without it the browser may evict our
  // map under disk pressure, and there's no backend to recover from.
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch { /* ignore */ }
  }

  $('import-btn').addEventListener('click', onImportClick);
  $('import-input').addEventListener('change', onImportFile);
  $('export-btn').addEventListener('click', onExportClick);
  $('clear-btn').addEventListener('click', onClearClick);

  // Map + Geoman + overlays. Failures here shouldn't crash the rest of the
  // page, so log and continue — the storage panel still works.
  try {
    map = await createMap(document.getElementById('map'));
    await attachGeoman(map);

    const overlays = await rasters.listMeta();
    for (const row of overlays) await mountOverlay(map, row);

    mountBuildingPlanImport({ map, refreshAll });
    mountLayersPanel({ map, refreshAll });
  } catch (err) {
    console.error('Map init failed:', err);
  }

  await refreshAll();

  // DevTools playground.
  window.imdf = {
    features, rasters, preferences, manifest: manifestStore,
    importZip, downloadZip, buildZip, clearAll, hasData,
    refresh: refreshAll,
    map,
  };
  console.log('IMDF Editor ready. Storage helpers on window.imdf');
}

init();
