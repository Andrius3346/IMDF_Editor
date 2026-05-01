// Manifest + bookkeeping on the singleton `meta` store.
//
// Reserved keys:
//   'manifest'        -> IMDF manifest object
//   'map_name'        -> string (user-facing label for the current map)
//   'imported_at'     -> epoch ms of last import
//   'schema_version'  -> editor schema version (string)

import { getDb, STORE } from './db.js';

const SCHEMA_VERSION = '1';

async function getValue(key) {
  const db = await getDb();
  const row = await db.get(STORE.META, key);
  return row ? row.value : null;
}

async function setValue(key, value) {
  const db = await getDb();
  await db.put(STORE.META, { key, value });
}

export const getManifest = () => getValue('manifest');
export const setManifest = (manifest) => setValue('manifest', manifest);

export const getMapName = () => getValue('map_name');
export const setMapName = (name) => setValue('map_name', name);

export const getImportedAt = () => getValue('imported_at');
export const markImported = () => setValue('imported_at', Date.now());

export const getSchemaVersion = () => getValue('schema_version');
export const stampSchemaVersion = () => setValue('schema_version', SCHEMA_VERSION);

/**
 * Build a minimal valid manifest for a brand-new (empty) map. Used when the
 * user starts from scratch instead of importing.
 */
export function newManifest({ language = 'en', generated_by = 'IMDF Editor' } = {}) {
  return {
    version: '1.0.0',
    created: new Date().toISOString(),
    generated_by,
    language,
  };
}
