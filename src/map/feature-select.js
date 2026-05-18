// Click handler for the IMDF features source. Outside the wizard, lets the
// user pick a rendered feature (footprint / venue polygon / level outline /
// unit polygon / address dot) and open the property panel for it.
//
// Priority order on each click (post-creation mode):
//   1. IMDF feature under the cursor wins — even if a gm_* feature is also
//      at this pixel. The active vertex-edit session adds a shadow copy of
//      the currently-edited polygon into gm_main, and clicks on its body
//      should still resolve to the underlying IMDF feature (so the user
//      can click from one polygon to another to switch selection).
//   2. Otherwise, if a gm_* helper is at the cursor (vertex handle, draw
//      preview, etc.), do nothing — Geoman is mid-gesture.
//   3. Otherwise, close the panel.
//
// During the wizard (body.wizard-active) we don't touch the panel — the
// wizard owns it — but we still let the user click any non-level polygon
// to start a vertex-edit session on it. Clicking off the feature commits
// the edit (geometry + auto-recomputed display_point) to IDB and ends the
// session.

import { SOURCE_ID, patchCachedFeatureGeometry, refreshFeaturesLayer } from './features-layer.js';
import { showFeatureForEdit, hidePropertyPanel, getCurrentFeatureId } from '../ui/property-panel.js';
import { startVertexEditSession } from './vertex-edit.js';
import { collectSnapTargetsForType } from '../ui/wizard/snap-targets.js';
import { polygonCentroid } from '../ui/wizard/geom-utils.js';
import * as features from '../storage/features.js';

let enabled = true;
// { row, session, mapRef } | null. mapRef captured for endWizardEditSession()
// callers that don't have the map handy (wizard teardown passes it explicitly).
let wizardEditSession = null;

export function installFeatureSelect(map) {
  map.on('click', async (ev) => {
    if (!enabled) return;

    const hits = map.queryRenderedFeatures(ev.point);
    const imdfHit = hits.find((f) => f.source === SOURCE_ID);
    const gmHit = hits.find(
      (f) => typeof f.source === 'string' && f.source.startsWith('gm_'),
    );

    if (document.body.classList.contains('wizard-active')) {
      await handleWizardClick(map, imdfHit, gmHit);
      return;
    }

    if (imdfHit) {
      const id = imdfHit.properties?.id;
      // Clicking the already-open feature is a no-op: tearing down and
      // restarting the edit session would just cause a vertex-handle flicker.
      if (id && id !== getCurrentFeatureId()) showFeatureForEdit(id);
      return;
    }

    if (gmHit) return; // Geoman is handling a vertex / handle interaction.

    if (getCurrentFeatureId()) hidePropertyPanel();
  });

  // Cursor affordance over IMDF features.
  for (const layerId of [
    'imdf-footprint-fill', 'imdf-level-fill', 'imdf-unit-fill',
    'imdf-venue-line',
  ]) {
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }
}

export function setFeatureSelectEnabled(value) {
  enabled = !!value;
}

// ---------------------------------------------------------------------------
// Wizard click-to-edit
// ---------------------------------------------------------------------------

async function handleWizardClick(map, imdfHit, gmHit) {
  // Clicked a level outline: leave the user's current session intact and don't
  // start a new one. Levels are vertex-locked during the wizard (and after) to
  // keep the footprint and ground-level in sync.
  if (imdfHit?.properties?.feature_type === 'level') return;

  if (imdfHit) {
    const id = imdfHit.properties?.id;
    if (!id) return;
    // Only the stub currently open in the wizard form is editable. Clicks on
    // any other IMDF feature (siblings of the same type, or different types
    // entirely) are silently ignored so the user can't desync the form from
    // the geometry session.
    const activeId = getCurrentFeatureId();
    if (!activeId || id !== activeId) return;
    // Same feature already in edit → no-op (avoid handle flicker).
    if (wizardEditSession && wizardEditSession.row.id === id) return;
    await endWizardEditSession(map);
    await startWizardEditOn(map, id);
    return;
  }

  // Clicked an active Geoman handle / vertex / drag preview → mid-gesture.
  if (gmHit) return;

  // Empty map click → commit any in-flight edit.
  await endWizardEditSession(map);
}

async function startWizardEditOn(map, featureId) {
  const row = await features.get(featureId);
  if (!row) return;
  if (!row.geometry
      || (row.geometry.type !== 'Polygon' && row.geometry.type !== 'MultiPolygon')) {
    return;
  }
  const snapTargets = await collectSnapTargetsForType(
    row.feature_type, row.level_id ?? null, { excludeId: row.id },
  );
  const session = await startVertexEditSession(map, {
    geometry: row.geometry,
    snapTargets,
    onLiveGeometry: (g) => {
      row.geometry = g;
      patchCachedFeatureGeometry(map, row.id, g);
    },
  });
  if (!session) return;
  wizardEditSession = { row, session, mapRef: map };
}

/**
 * Commit the in-flight wizard vertex edit (geometry + auto display_point) to
 * IDB and tear down the session. Safe to call when no session is open.
 *
 * Called from:
 *   - the click handler above when the user clicks off the feature or onto a
 *     different feature;
 *   - src/ui/wizard/wizard.js's finally block on wizard finish/abort, so the
 *     user's last drag isn't lost when body.wizard-active comes off.
 *
 * @param {object} [mapArg] Optional map; falls back to the one captured when
 *   the session was opened.
 */
export async function endWizardEditSession(mapArg) {
  if (!wizardEditSession) return;
  const { row, session, mapRef } = wizardEditSession;
  wizardEditSession = null;

  const map = mapArg ?? mapRef;
  const liveGeometry = session.getLive();
  try {
    await session.end();
  } catch (err) {
    console.warn('Wizard vertex edit: session.end failed', err);
  }

  // Persist whatever ended up on the polygon. We always write — the user may
  // have committed via click-away after a tiny drag that visually looks like a
  // no-op, and we'd rather pay one redundant IDB put than skip a real change.
  const updated = {
    ...row,
    geometry: liveGeometry,
    properties: {
      ...(row.properties ?? {}),
    },
  };
  const dp = computeDisplayPoint(liveGeometry);
  if (dp) updated.properties.display_point = dp;
  try {
    await features.put(updated);
    if (map) await refreshFeaturesLayer(map);
  } catch (err) {
    console.warn('Wizard vertex edit: commit failed', err);
  }
}

function computeDisplayPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return { type: 'Point', coordinates: polygonCentroid(geometry.coordinates) };
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates?.[0])) {
    return { type: 'Point', coordinates: polygonCentroid(geometry.coordinates[0]) };
  }
  return null;
}
