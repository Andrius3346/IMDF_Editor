// Entry module. Wires the storage layer, the MapLibre map canvas, the
// Geoman edit handles, and the building-plan georeferencing UX to the
// index.html shell.
//
// Persistence policy: the editor is intentionally session-only. On every
// page load we wipe IndexedDB, and on reload/close we warn the user via
// the browser's native unload prompt if there is unsaved work.

import * as features from './storage/features.js';
import * as rasters from './storage/rasters.js';
import * as manifestStore from './storage/manifest.js';
import { hasData, clearAll } from './storage/db.js';
import { importZip } from './io/zip-import.js';
import { downloadZip, buildZip } from './io/zip-export.js';

import { createMap } from './map/map.js';
import { attachGeoman } from './map/geoman.js';
import { mountFeaturesLayer, refreshFeaturesLayer } from './map/features-layer.js';
import { installFeatureSelect } from './map/feature-select.js';
import { mountBuildingPlanImport } from './ui/building-plan-import.js';
import { mountLayersPanel, refreshLayersPanel } from './ui/layers-panel.js';
import { mountPropertyPanel } from './ui/property-panel.js';
import { showWelcomeModal } from './ui/welcome-modal.js';
import { startWizard } from './ui/wizard/wizard.js';

const $ = (id) => document.getElementById(id);

let map = null;
let isDirty = false;

async function refreshHeader() {
  const manifest = await manifestStore.getManifest();
  const mapName = await manifestStore.getMapName();
  $('map-name').textContent = mapName ?? (manifest ? '(unnamed map)' : 'no map loaded');
}

async function refreshAll() {
  await refreshHeader();
  await refreshLayersPanel();
  if (map) await refreshFeaturesLayer(map);
  isDirty = await hasData();
}

async function onImportFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = ''; // allow re-picking the same file later
  if (!file) return;
  try {
    const result = await importZip(file, { mapName: file.name.replace(/\.zip$/i, '') });
    console.log('Imported:', result);
    if (result.warnings.length) console.warn('Import warnings:', result.warnings);
    setExportButtonVisible(true);
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
    await downloadZip(`${name}.zip`);
    isDirty = false;
  } catch (e) {
    console.error('Export failed:', e);
    alert(`Export failed: ${e.message}`);
  }
}

async function finishMapAndReload() {
  try {
    const name = (await manifestStore.getMapName()) ?? 'imdf-map';
    await downloadZip(`${name}.zip`);
  } catch (e) {
    console.error('Auto-export on finish failed:', e);
    alert(`Could not export map: ${e.message}`);
    return;
  }
  // The map was just saved to disk — clear isDirty so the beforeunload
  // listener doesn't prompt before reload.
  isDirty = false;
  // Tiny delay so the browser commits the blob download before navigation.
  setTimeout(() => window.location.reload(), 100);
}

async function presentWelcomeFlow() {
  setAddPlanButtonVisible(false);
  setExportButtonVisible(false);
  const choice = await showWelcomeModal();
  if (choice === 'create') {
    const result = await startWizard({ map, refreshAll });
    setAddPlanButtonVisible(true);
    if (result?.finished) await finishMapAndReload();
  } else {
    setAddPlanButtonVisible(true);
    if (choice === 'import') $('import-input').click();
  }
}

function setAddPlanButtonVisible(visible) {
  const btn = $('add-building-plan-btn');
  if (btn) btn.hidden = !visible;
}

function setExportButtonVisible(visible) {
  const btn = $('export-imdf-btn');
  if (btn) btn.hidden = !visible;
}

async function init() {
  // Session-only editor: wipe any leftover state from a previous session
  // before doing anything else, so the UI starts blank on every reload.
  await clearAll();

  // Native browser warning on reload / tab close / navigation when the
  // editor holds work the user hasn't exported.
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = ''; // Chrome requires a non-empty returnValue
  });

  $('import-input').addEventListener('change', onImportFile);
  $('export-imdf-btn').addEventListener('click', onExportClick);

  // Map + Geoman + overlays. Failures here shouldn't crash the rest of the
  // page, so log and continue — the sidebar still works.
  try {
    map = await createMap(document.getElementById('map'));
    await attachGeoman(map);
    mountFeaturesLayer(map);

    mountBuildingPlanImport({ map, refreshAll });
    mountLayersPanel({ map, refreshAll });
    mountPropertyPanel({ map, refreshAll });
    installFeatureSelect(map);
  } catch (err) {
    console.error('Map init failed:', err);
  }

  await refreshAll();

  // Welcome screen. clearAll() ran at the top of init(), so on every fresh
  // page load this prompts the user to pick a starting point. If they pick
  // "Import existing" we just trigger the existing file picker and let the
  // normal flow take over.
  if (map) await presentWelcomeFlow();

  // DevTools playground.
  window.imdf = {
    features, rasters, manifest: manifestStore,
    importZip, downloadZip, buildZip, clearAll, hasData,
    refresh: refreshAll,
    map,
  };
  console.log('IMDF Editor ready. Storage helpers on window.imdf');
}

init();
