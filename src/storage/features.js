// Feature CRUD on the `features` object store.
//
// Storage row shape:
//   { id, feature_type, geometry, properties, level_id, updated_at }
//
// Export shape (RFC 7946):
//   { id, type: 'Feature', feature_type, geometry, properties }

import { getDb, STORE } from './db.js';

/** All 16 IMDF feature types, in spec order. Used for export iteration. */
export const FEATURE_TYPES = Object.freeze([
  'venue', 'address', 'footprint', 'building', 'level', 'section',
  'unit', 'opening', 'fixture', 'anchor', 'occupant', 'amenity',
  'kiosk', 'detail', 'geofence', 'relationship',
]);

function uuid() {
  return crypto.randomUUID();
}

/**
 * Build the IDB row from a (possibly external) IMDF feature.
 * Assigns a UUID v4 if the feature is missing one.
 */
export function toRow(feature) {
  const id = feature.id || uuid();
  const props = feature.properties || {};
  return {
    id,
    feature_type: feature.feature_type,
    geometry: feature.geometry ?? null,
    properties: props,
    level_id: props.level_id ?? null,
    updated_at: Date.now(),
  };
}

/**
 * Project an IDB row to RFC 7946 GeoJSON Feature shape for export.
 */
export function toFeature(row) {
  return {
    id: row.id,
    type: 'Feature',
    feature_type: row.feature_type,
    geometry: row.geometry,
    properties: row.properties,
  };
}

export async function get(id) {
  const db = await getDb();
  const row = await db.get(STORE.FEATURES, id);
  return row ?? null;
}

/**
 * Insert or update one feature. Accepts either an IMDF feature or a row
 * shape — toRow normalizes both. Returns the stored row.
 */
export async function put(featureOrRow) {
  const row = featureOrRow.updated_at ? featureOrRow : toRow(featureOrRow);
  const db = await getDb();
  await db.put(STORE.FEATURES, row);
  return row;
}

export async function remove(id) {
  const db = await getDb();
  await db.delete(STORE.FEATURES, id);
}

export async function byType(featureType) {
  const db = await getDb();
  return db.getAllFromIndex(STORE.FEATURES, 'by_type', featureType);
}

export async function byLevel(levelId) {
  const db = await getDb();
  return db.getAllFromIndex(STORE.FEATURES, 'by_level', levelId);
}

export async function byTypeAndLevel(featureType, levelId) {
  const db = await getDb();
  return db.getAllFromIndex(STORE.FEATURES, 'by_type_level', [featureType, levelId]);
}

export async function all() {
  const db = await getDb();
  return db.getAll(STORE.FEATURES);
}

export async function count() {
  const db = await getDb();
  return db.count(STORE.FEATURES);
}

/**
 * Bulk insert. Wraps every put in one transaction, which is dramatically
 * faster than awaiting each put separately.
 */
export async function bulkPut(features) {
  if (features.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE.FEATURES, 'readwrite');
  const store = tx.objectStore(STORE.FEATURES);
  for (const f of features) store.put(toRow(f));
  await tx.done;
}

export async function clear() {
  const db = await getDb();
  await db.clear(STORE.FEATURES);
}
