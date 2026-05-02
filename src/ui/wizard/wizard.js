// Creation wizard. Drives the step-by-step flow that takes a user from a
// blank session to an exportable IMDF (single venue, single building,
// floor-by-floor). See plan: ~/.claude/plans/the-warning-of-lost-nifty-salamander.md

import * as features from '../../storage/features.js';
import * as rasters from '../../storage/rasters.js';
import * as manifestStore from '../../storage/manifest.js';

import { showModal } from './forms.js';
import { FOOTPRINT_CATEGORY } from './categories.js';
import { polygonCentroid } from './geom-utils.js';
import * as activeState from './active-state.js';

import { drawPolygon } from '../../map/draw.js';
import { refreshFeaturesLayer, setActiveLevel } from '../../map/features-layer.js';
import { importBuildingPlan } from '../building-plan-import.js';
import { showFeatureForWizard } from '../property-panel.js';

let ctx = null; // { map, refreshAll }

/**
 * Entry point. Called from main.js after the user picks "Create new" on
 * the welcome modal.
 */
export async function startWizard({ map, refreshAll }) {
  ctx = { map, refreshAll };
  activeState.reset();
  activeState.update({ active: true });

  hideHeaderActions(true);
  document.body.classList.add('wizard-active');

  // Mint a fresh manifest so hasData() returns true and the rest of the
  // app sees a map.
  await manifestStore.setManifest(manifestStore.newManifest());
  await manifestStore.setMapName('Untitled venue');
  await refreshAll?.();

  let finished = false;
  try {
    finished = (await runFlow()) === true;
  } catch (err) {
    console.error('Wizard aborted:', err);
  } finally {
    activeState.update({ active: false });
    hideHeaderActions(false);
    document.body.classList.remove('wizard-active');
    setActiveLevel(map, null);
    await refreshAll?.();
  }
  return { finished };
}

async function runFlow() {
  const addressId = await stepAddress();
  if (!addressId) return;
  activeState.update({ addressId });

  // Step 2: upload venue plan + draw venue polygon + venue attrs form.
  const venueName = await stepVenue(addressId);
  if (!venueName) return;

  // Step 3: building attrs form (geometry null per IMDF "unlocated").
  const buildingId = await stepBuilding();
  if (!buildingId) return;

  // Step 4: ground floor (level) details form (no geometry yet).
  const levelOk = await stepLevel(0);
  if (!levelOk) return;

  // Step 5: upload ground floor plan + draw floor extent → auto footprint,
  // attach geometry to step-4 level, back-fill building.display_point.
  await stepFootprintAndLevelGeometry();
  await stepUnits();

  // Per-floor loop for additional floors.
  while (true) {
    const next = await stepNextOrFinish();
    if (next === null) break; // Finish
    await stepUploadPlan(next);
    await stepFloor(next);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Step 1: Address form
// ---------------------------------------------------------------------------

async function stepAddress() {
  // Pre-create the stub so the panel has a row to load. Cancel deletes it.
  const stub = await features.put({
    feature_type: 'address',
    geometry: null,
    properties: { country: 'LT' },
  });
  await refresh();

  const result = await showFeatureForWizard({
    featureId: stub.id,
    step: {
      current: 1, total: 5, title: 'Building address',
      intro: 'Enter the address of the building you are mapping. Country uses ISO 3166-1 alpha-2; province uses ISO 3166-2 (e.g. LT-VL) if applicable.',
    },
    primaryLabel: 'Continue',
    onCancel: async () => { await features.remove(stub.id); },
  });
  if (!result) return null;
  await refresh();
  return stub.id;
}

// ---------------------------------------------------------------------------
// Step 2: Upload venue plan → draw venue polygon → fill venue attrs
// ---------------------------------------------------------------------------

async function stepVenue(addressId) {
  // 2a — Prompt for the venue boundary plan PNG.
  const ack = await showModal({
    title: 'Step 2 of 5 — Upload venue boundary plan',
    intro: 'Pick a PNG showing the venue\'s formal property boundary. After upload you will georeference it onto the satellite imagery, then trace the venue polygon on top of it.',
    actions: [{ id: 'pick', label: 'Pick PNG…', primary: true }],
    dismissable: false,
  });
  if (!ack) throw new Error('cancelled');

  // 2b — File picker + georef edit session.
  await pickAndImportPlan('Venue boundary');

  // 2c — Draw the venue boundary on top of the georeferenced plan.
  const prompt = showFloatingPrompt({
    title: 'Step 2 of 5 — Draw the venue boundary',
    hint: 'Trace the venue\'s formal property boundary. Double-click the last point to finish.',
  });
  const ctl = drawPolygon(ctx.map);
  prompt.cancelBtn.onclick = () => ctl.cancel();
  const geometry = await ctl.promise;
  prompt.dismiss();
  if (!geometry) throw new Error('cancelled');

  // 2d — Pre-create the venue stub with geometry + auto display_point.
  const centroid = polygonCentroid(geometry.coordinates);
  const stub = await features.put({
    feature_type: 'venue',
    geometry,
    properties: {
      category: 'education',
      name: { en: '' },
      address_id: addressId,
      display_point: { type: 'Point', coordinates: centroid },
    },
  });
  await refresh();

  // 2e — Open the venue form (display_point hidden — auto-set above).
  const result = await showFeatureForWizard({
    featureId: stub.id,
    step: {
      current: 2, total: 5, title: 'Venue',
      intro: 'Identify the venue. The name shown here will appear in the editor header. Pick a category from the full IMDF vocabulary.',
    },
    primaryLabel: 'Continue',
    hideFields: ['display_point'],
    onCancel: async () => { await features.remove(stub.id); },
  });
  if (!result) return null;

  const saved = await features.get(stub.id);
  const venueName = saved?.properties?.name?.en ?? 'Untitled venue';
  activeState.update({ venueId: stub.id });
  await manifestStore.setMapName(venueName);
  await refresh();
  return venueName;
}

// ---------------------------------------------------------------------------
// Step 3: Building attributes form (geometry: null per IMDF "unlocated").
// display_point is back-filled in step 5 from the footprint centroid.
// ---------------------------------------------------------------------------

async function stepBuilding() {
  const state = activeState.getState();
  const stub = await features.put({
    feature_type: 'building',
    geometry: null, // IMDF "unlocated" — footprint carries the extent
    properties: {
      category: 'unspecified',
      address_id: state.addressId,
      name: { en: (await manifestStore.getMapName()) || 'Building' },
    },
  });
  await refresh();

  const result = await showFeatureForWizard({
    featureId: stub.id,
    step: {
      current: 3, total: 5, title: 'Building',
      intro: 'Building records are unlocated in IMDF — the footprint you draw in step 5 carries the actual outline. Pick a category and confirm the name.',
    },
    primaryLabel: 'Continue',
    hideFields: ['display_point'],
    onCancel: async () => { await features.remove(stub.id); },
  });
  if (!result) return null;

  activeState.update({ buildingId: stub.id });
  await refresh();
  return stub.id;
}

// ---------------------------------------------------------------------------
// Step 4: Ground floor (level) details form. Geometry filled in step 5.
// ---------------------------------------------------------------------------

async function stepLevel(ordinal) {
  const state = activeState.getState();
  const stub = await features.put({
    feature_type: 'level',
    geometry: null,
    properties: {
      category: 'ground',
      ordinal,
      name: { en: defaultFloorName(ordinal) },
      building_ids: [state.buildingId],
    },
  });
  await refresh();

  const result = await showFeatureForWizard({
    featureId: stub.id,
    step: {
      current: 4, total: 5, title: 'Ground floor details',
      intro: 'Confirm the floor\'s name, ordinal, and category. The floor outline itself is drawn in step 5.',
    },
    primaryLabel: 'Continue',
    hideFields: ['display_point', 'building_ids'],
    onCancel: async () => { await features.remove(stub.id); },
  });
  if (!result) return false;

  const saved = await features.get(stub.id);
  const savedOrdinal = saved?.properties?.ordinal ?? ordinal;
  activeState.update({
    currentLevelId: stub.id,
    currentOrdinal: savedOrdinal,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Step 5: Upload ground floor plan → draw floor extent → auto footprint +
// attach geometry to the step-4 level + back-fill building.display_point.
// ---------------------------------------------------------------------------

async function stepFootprintAndLevelGeometry() {
  const ack = await showModal({
    title: 'Step 5 of 5 — Upload ground floor plan',
    intro: 'Pick a PNG of the ground floor plan. After upload you will georeference it, then trace the floor extent — the polygon will become both the building footprint and the ground level outline.',
    actions: [{ id: 'pick', label: 'Pick PNG…', primary: true }],
    dismissable: false,
  });
  if (!ack) throw new Error('cancelled');

  await pickAndImportPlan(defaultFloorName(0));

  const prompt = showFloatingPrompt({
    title: 'Step 5 of 5 — Draw the floor extent',
    hint: 'Trace the ground floor outline. Double-click the last point to finish.',
  });
  const ctl = drawPolygon(ctx.map, {
    snapTargets: await collectSnapTargets(['venue']),
  });
  prompt.cancelBtn.onclick = () => ctl.cancel();
  const geometry = await ctl.promise;
  prompt.dismiss();
  if (!geometry) throw new Error('cancelled');

  const state = activeState.getState();
  const centroid = polygonCentroid(geometry.coordinates);
  const displayPoint = { type: 'Point', coordinates: centroid };

  // Auto-create the footprint — fixed shape per the wizard's v1 contract.
  const footprint = await features.put({
    feature_type: 'footprint',
    geometry,
    properties: {
      category: FOOTPRINT_CATEGORY,
      name: null,
      building_ids: [state.buildingId],
    },
  });

  // Attach geometry + display_point to the step-4 ground level.
  const levelRow = await features.get(state.currentLevelId);
  if (levelRow) {
    levelRow.geometry = geometry;
    levelRow.properties = {
      ...levelRow.properties,
      display_point: displayPoint,
    };
    await features.put(levelRow);
  }

  // Back-fill the building's display_point from the footprint centroid.
  const buildingRow = await features.get(state.buildingId);
  if (buildingRow) {
    buildingRow.properties = {
      ...buildingRow.properties,
      display_point: displayPoint,
    };
    await features.put(buildingRow);
  }

  // Back-fill the address Point at the same centroid (matches old behavior).
  const addressRow = await features.get(state.addressId);
  if (addressRow) {
    addressRow.geometry = { type: 'Point', coordinates: centroid };
    await features.put(addressRow);
  }

  // Tag this floor's raster with the level id so they're linked.
  if (state.currentRasterId) {
    await rasters.update(state.currentRasterId, { level_id: state.currentLevelId });
  }

  activeState.update({ footprintId: footprint.id });
  setActiveLevel(ctx.map, state.currentLevelId);
  await refresh();
}

// ---------------------------------------------------------------------------
// Per-floor (ordinal > 0): upload + georeference building plan
// ---------------------------------------------------------------------------

async function stepUploadPlan(ordinal) {
  const ack = await showModal({
    title: `Add floor ${formatOrdinal(ordinal)} — upload plan`,
    intro: `Pick a PNG for floor ${formatOrdinal(ordinal)}. You will georeference it before drawing the level outline and rooms.`,
    actions: [{ id: 'pick', label: 'Pick PNG…', primary: true }],
    dismissable: false,
  });
  if (!ack) throw new Error('cancelled');

  await pickAndImportPlan(defaultFloorName(ordinal));
}

async function pickAndImportPlan(name) {
  while (true) {
    const file = await pickFile();
    if (!file) {
      // User cancelled the OS picker — re-show retry prompt.
      const retry = await showModal({
        title: 'No file selected',
        intro: 'A building-plan PNG is required to continue.',
        actions: [{ id: 'retry', label: 'Pick PNG…', primary: true, validate: false }],
        dismissable: false,
      });
      if (!retry) throw new Error('cancelled');
      continue;
    }

    const row = await new Promise((resolve, reject) => {
      importBuildingPlan(file, {
        map: ctx.map,
        refreshAll: ctx.refreshAll,
        name,
        onCommit: (committed) => resolve(committed),
        onCancel: () => resolve(null),
      }).catch(reject);
    });

    if (row) {
      activeState.update({ currentRasterId: row.id });
      return row;
    }

    // User cancelled georeferencing — find the most recent raster and remove it.
    // (importBuildingPlan persisted the row before resolving onCancel.)
    const overlays = await rasters.listMeta();
    if (overlays.length) {
      const newest = overlays.reduce((a, b) =>
        (a.created_at ?? 0) > (b.created_at ?? 0) ? a : b);
      await rasters.remove(newest.id);
      // Also unmount visually.
      const { unmountOverlay } = await import('../../map/raster-layers.js');
      unmountOverlay(ctx.map, newest.id);
    }
    await ctx.refreshAll?.();

    // Re-prompt the user to pick again.
    const retry = await showModal({
      title: 'Plan not georeferenced',
      intro: 'The building plan was discarded. Pick another PNG to continue.',
      actions: [{ id: 'retry', label: 'Pick PNG…', primary: true, validate: false }],
      dismissable: false,
    });
    if (!retry) throw new Error('cancelled');
  }
}

/**
 * Trigger a fresh hidden file input and resolve with the chosen File, or
 * null if the user cancelled the picker. We create the input dynamically
 * so we don't share an element (and a change handler) with
 * mountBuildingPlanImport, which is wired up in main.js for the
 * standalone "Add building plan" header button. Cancellation is detected
 * via a window-focus + empty-files check (no portable cancel event).
 */
function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,image/png';
    input.style.display = 'none';
    document.body.appendChild(input);

    let resolved = false;
    const finish = (file) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('focus', onFocus);
      input.removeEventListener('change', onChange);
      input.remove();
      resolve(file);
    };

    const onChange = () => finish(input.files?.[0] ?? null);
    const onFocus = () => {
      setTimeout(() => {
        if (resolved) return;
        if (!input.files?.[0]) finish(null);
      }, 300);
    };

    input.addEventListener('change', onChange);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Per-floor (ordinal > 0): draw level outline → fill level form → unit loop
// ---------------------------------------------------------------------------

async function stepFloor(ordinal) {
  // Draw level outline.
  const prompt = showFloatingPrompt({
    title: `Floor ${formatOrdinal(ordinal)} — draw level outline`,
    hint: 'Click around the floor outline as it appears in the plan. Double-click to finish.',
  });
  const ctl = drawPolygon(ctx.map, {
    snapTargets: await collectSnapTargets(['footprint', 'venue', 'level']),
  });
  prompt.cancelBtn.onclick = () => ctl.cancel();
  const geometry = await ctl.promise;
  prompt.dismiss();

  if (!geometry) throw new Error('cancelled');

  const state = activeState.getState();
  const centroid = polygonCentroid(geometry.coordinates);

  // Stub level row → panel exposes the level schema (display_point and
  // building_ids hidden — auto-set / linked).
  const stub = await features.put({
    feature_type: 'level',
    geometry,
    properties: {
      category: 'unspecified',
      ordinal,
      name: { en: defaultFloorName(ordinal) },
      building_ids: [state.buildingId],
      display_point: { type: 'Point', coordinates: centroid },
    },
  });
  await refresh();

  const result = await showFeatureForWizard({
    featureId: stub.id,
    step: {
      current: 0, total: 0,
      title: `Floor ${formatOrdinal(ordinal)} — level details`,
      intro: 'Set the floor name, ordinal, and any optional metadata.',
    },
    primaryLabel: 'Continue',
    hideFields: ['display_point', 'building_ids'],
    onCancel: async () => { await features.remove(stub.id); },
  });
  if (!result) throw new Error('cancelled');

  const saved = await features.get(stub.id);
  const savedOrdinal = saved?.properties?.ordinal ?? ordinal;

  activeState.update({
    currentLevelId: stub.id,
    currentOrdinal: savedOrdinal,
  });

  // Tag the floor's raster with this level id so they're linked.
  if (state.currentRasterId) {
    await rasters.update(state.currentRasterId, { level_id: stub.id });
  }

  setActiveLevel(ctx.map, stub.id);
  await refresh();

  // Unit sub-loop.
  await stepUnits();
}

async function stepUnits() {
  const state = activeState.getState();
  const panel = showFloorPanel({
    title: `Floor ${formatOrdinal(state.currentOrdinal)} — add rooms`,
    levelId: state.currentLevelId,
  });

  while (true) {
    panel.refreshCount();
    const action = await panel.waitForAction();
    if (action === 'done') {
      panel.dismiss();
      return;
    }
    // Add unit: draw → form → save.
    panel.setBusy(true);
    const drawPrompt = showFloatingPrompt({
      title: `Floor ${formatOrdinal(state.currentOrdinal)} — draw room outline`,
      hint: 'Click around the room. Double-click to finish.',
    });
    // Snap to the level outline + any units already drawn on this floor.
    const unitSnap = await collectUnitSnapTargets(state.currentLevelId);
    const ctl = drawPolygon(ctx.map, { snapTargets: unitSnap });
    drawPrompt.cancelBtn.onclick = () => ctl.cancel();
    const geometry = await ctl.promise;
    drawPrompt.dismiss();
    panel.setBusy(false);

    if (!geometry) continue; // user cancelled the draw

    // Stub unit row → panel exposes the full IMDF unit schema.
    const unitCentroid = polygonCentroid(geometry.coordinates);
    const stub = await features.put({
      feature_type: 'unit',
      geometry,
      properties: {
        category: 'room',
        name: { en: '' },
        level_id: state.currentLevelId,
        display_point: { type: 'Point', coordinates: unitCentroid },
      },
    });
    await refresh();

    const result = await showFeatureForWizard({
      featureId: stub.id,
      step: {
        current: 0, total: 0, // sub-loop, no step counter
        title: 'Room details',
        intro: 'Pick a category from the full IMDF unit vocabulary. Add accessibility and alternate names if relevant.',
      },
      primaryLabel: 'Save room',
      hideFields: ['display_point'],
      onCancel: async () => { await features.remove(stub.id); },
    });
    if (!result) {
      await refresh();
      panel.refreshCount();
      continue;
    }

    await refresh();
    panel.refreshCount();
  }
}

// ---------------------------------------------------------------------------
// Next floor or finish
// ---------------------------------------------------------------------------

async function stepNextOrFinish() {
  const levels = (await features.byType('level')).slice().sort(
    (a, b) => (a.properties?.ordinal ?? 0) - (b.properties?.ordinal ?? 0),
  );

  const summary = await Promise.all(levels.map(async (lv) => {
    const units = await features.byTypeAndLevel('unit', lv.id);
    return {
      ordinal: lv.properties?.ordinal,
      name: lv.properties?.name?.en ?? '',
      units: units.length,
    };
  }));

  const tableHtml = summary.map((s) =>
    `<tr><td><b>${formatOrdinal(s.ordinal)}</b></td><td>${escapeHtml(s.name)}</td><td>${s.units} room${s.units === 1 ? '' : 's'}</td></tr>`
  ).join('');

  // We render a small inline table inside the modal intro by using a fake
  // field with custom rendering. Simpler: reuse intro for prose and put
  // the table in a dedicated element appended to the modal body.
  const result = await showFloorListModal(tableHtml);
  if (!result) return null;
  if (result === 'finish') return null;

  // Add another floor — pick ordinal.
  const filledOrdinals = summary.map((s) => s.ordinal).filter((o) => Number.isFinite(o));
  const suggested = filledOrdinals.length
    ? Math.max(...filledOrdinals) + 1
    : 1;

  while (true) {
    const ordResult = await showModal({
      title: 'Add another floor',
      intro: 'Pick the ordinal of the new floor (0 = ground, 1 = first up, -1 = basement, etc.).',
      fields: [
        { name: 'ordinal', label: 'Ordinal', type: 'number',
          required: true, value: suggested, step: 1 },
      ],
      actions: [
        { id: 'cancel', label: 'Back', validate: false },
        { id: 'submit', label: 'Continue', primary: true },
      ],
      dismissable: false,
    });
    if (!ordResult || ordResult.actionId !== 'submit') {
      // Back to the floor-list modal.
      return await stepNextOrFinish();
    }
    const ord = ordResult.values.ordinal;
    if (filledOrdinals.includes(ord)) {
      // Re-show with explicit error.
      await showModal({
        title: 'Floor already exists',
        intro: `A floor with ordinal ${ord} is already in the map. Pick a different ordinal.`,
        actions: [{ id: 'ok', label: 'OK', primary: true, validate: false }],
        dismissable: false,
      });
      continue;
    }
    return ord;
  }
}

async function showFloorListModal(tableHtml) {
  return new Promise((resolve) => {
    showModal({
      title: 'Floors so far',
      intro: 'Add another floor or finish the map. Floors completed:',
      fields: [],
      actions: [
        { id: 'finish', label: 'Finish map', validate: false },
        { id: 'add',    label: '+ Add another floor', primary: true, validate: false },
      ],
      dismissable: false,
    }).then((res) => resolve(res?.actionId === 'add' ? 'add' : 'finish'));

    // Inject the table into the freshly-rendered modal body.
    requestAnimationFrame(() => {
      const overlay = document.querySelector('#modal-root .modal-overlay:last-child');
      const body = overlay?.querySelector('.modal-body');
      if (!body) return;
      const table = document.createElement('table');
      table.className = 'floor-list';
      table.innerHTML = `<tbody>${tableHtml}</tbody>`;
      body.appendChild(table);
    });
  });
}

// ---------------------------------------------------------------------------
// Floating prompts (non-modal map-overlay UI)
// ---------------------------------------------------------------------------

function showFloatingPrompt({ title, hint }) {
  const mapEl = document.getElementById('map');
  const el = document.createElement('div');
  el.className = 'wizard-floating-prompt';
  el.innerHTML = `
    <div class="title"></div>
    <p class="hint"></p>
    <div class="actions">
      <button type="button" class="cancel">Cancel</button>
    </div>
  `;
  el.querySelector('.title').textContent = title;
  el.querySelector('.hint').textContent = hint;
  mapEl.appendChild(el);
  return {
    cancelBtn: el.querySelector('.cancel'),
    dismiss: () => el.remove(),
  };
}

function showFloorPanel({ title, levelId }) {
  const mapEl = document.getElementById('map');
  const el = document.createElement('div');
  el.className = 'wizard-floor-panel';
  el.innerHTML = `
    <div class="title"></div>
    <div class="meta"></div>
    <div class="actions">
      <button type="button" class="add primary">+ Add room</button>
      <button type="button" class="done">Done with this floor</button>
    </div>
  `;
  el.querySelector('.title').textContent = title;
  mapEl.appendChild(el);

  const addBtn = el.querySelector('.add');
  const doneBtn = el.querySelector('.done');
  const meta = el.querySelector('.meta');

  let resolveAction = null;
  let unitCount = 0;

  const refreshCount = async () => {
    const units = await features.byTypeAndLevel('unit', levelId);
    unitCount = units.length;
    meta.textContent = `Rooms on this floor: ${unitCount}`;
    doneBtn.disabled = unitCount === 0;
    doneBtn.title = unitCount === 0 ? 'Add at least one room before continuing.' : '';
  };

  addBtn.onclick = () => resolveAction?.('add');
  doneBtn.onclick = () => { if (!doneBtn.disabled) resolveAction?.('done'); };

  return {
    refreshCount,
    setBusy: (busy) => {
      addBtn.disabled = busy;
      doneBtn.disabled = busy || unitCount === 0;
    },
    waitForAction: () => new Promise((r) => { resolveAction = r; }),
    dismiss: () => el.remove(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function refresh() {
  await refreshFeaturesLayer(ctx.map);
  await ctx.refreshAll?.();
}

/**
 * Collect saved feature geometries to use as snap anchors for the next
 * draw. Geoman's snapping helper only sees features in its own gm_main
 * source, so we briefly re-import these for the duration of each draw
 * (see src/map/draw.js).
 */
async function collectSnapTargets(featureTypes) {
  const out = [];
  for (const t of featureTypes) {
    const rows = await features.byType(t);
    for (const r of rows) {
      if (r.geometry && (r.geometry.type === 'Polygon' || r.geometry.type === 'MultiPolygon')) {
        out.push(r.geometry);
      }
    }
  }
  return out;
}

async function collectUnitSnapTargets(levelId) {
  const targets = await collectSnapTargets(['footprint']);
  const levelRow = await features.get(levelId);
  if (levelRow?.geometry) targets.push(levelRow.geometry);
  const units = await features.byTypeAndLevel('unit', levelId);
  for (const u of units) if (u.geometry) targets.push(u.geometry);
  return targets;
}

function hideHeaderActions(hide) {
  // While the wizard is running, hide the "Add building plan" button — the
  // wizard drives plan uploads itself via the same hidden file input.
  const btn = document.getElementById('add-building-plan-btn');
  if (btn) btn.hidden = hide;
}

function defaultFloorName(ordinal) {
  if (ordinal === 0) return 'Ground floor';
  if (ordinal === -1) return 'Basement';
  if (ordinal > 0) return `Floor ${ordinal}`;
  return `Basement ${Math.abs(ordinal)}`;
}

function formatOrdinal(ordinal) {
  if (!Number.isFinite(ordinal)) return '?';
  if (ordinal === 0) return '0 (ground)';
  return String(ordinal);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
