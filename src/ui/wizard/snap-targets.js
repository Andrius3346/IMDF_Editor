// Collect saved feature geometries to use as snap anchors. Used in two places:
//
//   - src/ui/wizard/wizard.js: feeds drawPolygon's `snapTargets` so each
//     freehand draw has nearby features to snap to.
//   - src/map/feature-select.js + src/ui/property-panel.js: feeds the
//     vertex-edit session so dragging a vertex on an existing feature can
//     snap to its neighbours.
//
// Geoman's snapping helper only sees features that already live in gm_main,
// so the consumers import these geometries into gm_main for the duration of
// the session and remove them again afterwards.
//
// Self-exclusion (`excludeId`) is required for the vertex-edit case — the
// edited feature is itself in gm_main, and a duplicate copy would create a
// self-overlapping snap anchor.

import * as features from '../../storage/features.js';

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);

/**
 * Snap targets keyed by feature type. Type drives which features become
 * candidate anchors:
 *   - unit      → footprint + this level's outline + sibling units on the level
 *   - footprint → venue
 *   - level     → footprint + venue + other levels
 *   - venue     → none (top of the hierarchy)
 *   - other     → none (no editing path)
 *
 * @param {string} featureType
 * @param {string|null} levelId  Only used for 'unit' to pick siblings.
 * @param {object} [options]
 * @param {string} [options.excludeId]  Skip this feature id when scanning.
 * @returns {Promise<Array<object>>}
 */
export async function collectSnapTargetsForType(featureType, levelId, { excludeId } = {}) {
  if (featureType === 'unit') {
    const targets = [];
    await pushPolygons(targets, await features.byType('footprint'), excludeId);
    if (levelId) {
      const levelRow = await features.get(levelId);
      if (levelRow && excludeId !== levelRow.id && hasPolygon(levelRow)) {
        targets.push(levelRow.geometry);
      }
      const units = await features.byTypeAndLevel('unit', levelId);
      await pushPolygons(targets, units, excludeId);
    }
    return targets;
  }
  if (featureType === 'footprint') {
    const targets = [];
    await pushPolygons(targets, await features.byType('venue'), excludeId);
    return targets;
  }
  if (featureType === 'level') {
    const targets = [];
    await pushPolygons(targets, await features.byType('footprint'), excludeId);
    await pushPolygons(targets, await features.byType('venue'), excludeId);
    await pushPolygons(targets, await features.byType('level'), excludeId);
    return targets;
  }
  if (featureType === 'opening') {
    // Doorways sit on unit walls / level boundaries — those are the natural
    // anchors for endpoint snapping.
    const targets = [];
    if (levelId) {
      const levelRow = await features.get(levelId);
      if (levelRow && excludeId !== levelRow.id && hasPolygon(levelRow)) {
        targets.push(levelRow.geometry);
      }
      const units = await features.byTypeAndLevel('unit', levelId);
      await pushPolygons(targets, units, excludeId);
    }
    return targets;
  }
  return [];
}

/**
 * Looser variant used by the wizard's draw steps where there's no "self" yet
 * (the feature hasn't been created), but we still want a typed set of anchors.
 *
 * @param {string[]} featureTypes
 */
export async function collectSnapTargetsForTypes(featureTypes) {
  const out = [];
  for (const t of featureTypes) {
    const rows = await features.byType(t);
    await pushPolygons(out, rows);
  }
  return out;
}

async function pushPolygons(out, rows, excludeId) {
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (hasPolygon(r)) out.push(r.geometry);
  }
}

function hasPolygon(row) {
  return !!row?.geometry && POLYGON_TYPES.has(row.geometry.type);
}
