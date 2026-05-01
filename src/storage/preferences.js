// Editor UI state, persisted across reloads.
// Plain key/value over the `preferences` object store.
//
// Conventional keys (free-form — anything is allowed):
//   active_level_id   -> UUID of the currently visible level
//   last_viewport     -> { center: [lng, lat], zoom, bearing, pitch }
//   snap_settings     -> { enabled, tolerance_px, snap_to: { vertex, edge, grid } }
//   layer_visibility  -> Record<feature_type, boolean>

import { getDb, STORE } from './db.js';

export async function get(key) {
  const db = await getDb();
  const row = await db.get(STORE.PREFERENCES, key);
  return row ? row.value : null;
}

export async function set(key, value) {
  const db = await getDb();
  await db.put(STORE.PREFERENCES, { key, value });
}

export async function remove(key) {
  const db = await getDb();
  await db.delete(STORE.PREFERENCES, key);
}

export async function all() {
  const db = await getDb();
  const rows = await db.getAll(STORE.PREFERENCES);
  const out = {};
  for (const { key, value } of rows) out[key] = value;
  return out;
}

export async function clear() {
  const db = await getDb();
  await db.clear(STORE.PREFERENCES);
}
