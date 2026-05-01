// IndexedDB schema for the IMDF editor.
// One database, three object stores; used as the in-session state holder
// for features, rasters, and the manifest. The DB is wiped on every page
// load — see src/main.js — so it is never read across reloads.

import { openDB } from 'https://esm.sh/idb@8';

const DB_NAME = 'imdf-editor';
// v2 drops the legacy 'preferences' store left over from when the editor
// restored UI state across reloads.
const DB_VERSION = 2;

export const STORE = Object.freeze({
  META: 'meta',
  FEATURES: 'features',
  RASTERS: 'raster_overlays',
});

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) createV1Schema(db);
        if (oldVersion < 2 && db.objectStoreNames.contains('preferences')) {
          db.deleteObjectStore('preferences');
        }
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
}

/**
 * Wipe every store. Used by import-replace and a "Clear data" UI action.
 */
export async function clearAll() {
  const db = await getDb();
  const tx = db.transaction(
    [STORE.META, STORE.FEATURES, STORE.RASTERS],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore(STORE.META).clear(),
    tx.objectStore(STORE.FEATURES).clear(),
    tx.objectStore(STORE.RASTERS).clear(),
  ]);
  await tx.done;
}

/**
 * True if any IMDF data is present (manifest, features, or raster
 * overlays). Used to decide whether import should prompt the user before
 * replacing, and to gate the page-unload warning in main.js.
 */
export async function hasData() {
  const db = await getDb();
  const featureCount = await db.count(STORE.FEATURES);
  if (featureCount > 0) return true;
  const rasterCount = await db.count(STORE.RASTERS);
  if (rasterCount > 0) return true;
  const manifest = await db.get(STORE.META, 'manifest');
  return manifest !== undefined;
}
