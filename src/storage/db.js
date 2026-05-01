// IndexedDB schema for the IMDF editor.
// One database, four object stores. See plan for rationale.

import { openDB } from 'https://esm.sh/idb@8';

const DB_NAME = 'imdf-editor';
const DB_VERSION = 1;

export const STORE = Object.freeze({
  META: 'meta',
  FEATURES: 'features',
  RASTERS: 'raster_overlays',
  PREFERENCES: 'preferences',
});

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) createV1Schema(db);
      },
      blocked() {
        console.warn('IMDF editor: another tab is holding an older DB version open.');
      },
      blocking() {
        // A newer version wants to upgrade. Close so the other tab can proceed.
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

function createV1Schema(db) {
  db.createObjectStore(STORE.META, { keyPath: 'key' });

  const features = db.createObjectStore(STORE.FEATURES, { keyPath: 'id' });
  features.createIndex('by_type', 'feature_type');
  features.createIndex('by_level', 'level_id');
  features.createIndex('by_type_level', ['feature_type', 'level_id']);

  const rasters = db.createObjectStore(STORE.RASTERS, { keyPath: 'id' });
  rasters.createIndex('by_level', 'level_id');

  db.createObjectStore(STORE.PREFERENCES, { keyPath: 'key' });
}

/**
 * Wipe every store. Used by import-replace and a "Clear data" UI action.
 */
export async function clearAll() {
  const db = await getDb();
  const tx = db.transaction(
    [STORE.META, STORE.FEATURES, STORE.RASTERS, STORE.PREFERENCES],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore(STORE.META).clear(),
    tx.objectStore(STORE.FEATURES).clear(),
    tx.objectStore(STORE.RASTERS).clear(),
    tx.objectStore(STORE.PREFERENCES).clear(),
  ]);
  await tx.done;
}

/**
 * True if any IMDF data is present (manifest or features). Used to decide
 * whether import should prompt the user before replacing.
 */
export async function hasData() {
  const db = await getDb();
  const featureCount = await db.count(STORE.FEATURES);
  if (featureCount > 0) return true;
  const manifest = await db.get(STORE.META, 'manifest');
  return manifest !== undefined;
}
