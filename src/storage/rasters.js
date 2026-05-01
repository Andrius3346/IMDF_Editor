// Raster overlay CRUD (georeferenced floor plans).
//
// Each row holds two Blobs:
//   - source_blob  : original PNG (kept for re-georeferencing)
//   - display_blob : PNG used by the map renderer
//
// Source Blobs can be tens of megabytes, so callers should prefer
// `getMeta(id)` (no source_blob) when they only need transform/bounds.

import { getDb, STORE } from './db.js';

function uuid() {
  return crypto.randomUUID();
}

/**
 * Create a new raster overlay row. Caller supplies blobs and georeferencing.
 *   create({
 *     name, source_format, source_blob, display_blob,
 *     gcps, transform, bounds, level_id?, opacity?, visible?, z_order?,
 *   })
 */
export async function create(input) {
  const row = {
    id: uuid(),
    level_id: input.level_id ?? null,
    name: input.name,
    source_format: input.source_format,
    source_blob: input.source_blob,
    display_blob: input.display_blob,
    gcps: input.gcps ?? [],
    transform: input.transform ?? [1, 0, 0, 1, 0, 0],
    bounds: input.bounds,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    z_order: input.z_order ?? 0,
    created_at: Date.now(),
  };
  const db = await getDb();
  await db.put(STORE.RASTERS, row);
  return row;
}

export async function get(id) {
  const db = await getDb();
  const row = await db.get(STORE.RASTERS, id);
  return row ?? null;
}

/**
 * Get everything except the heavy source_blob. Use this to build the layer
 * list / overlay panel without loading megabytes per overlay.
 */
export async function getMeta(id) {
  const row = await get(id);
  if (!row) return null;
  const { source_blob, ...meta } = row;
  return meta;
}

/**
 * Get just the source PNG — call only when re-georeferencing.
 */
export async function getSourceBlob(id) {
  const row = await get(id);
  return row ? row.source_blob : null;
}

/**
 * Get just the display PNG — call when (re)attaching an overlay to the map.
 */
export async function getDisplayBlob(id) {
  const row = await get(id);
  return row ? row.display_blob : null;
}

export async function update(id, patch) {
  const db = await getDb();
  const tx = db.transaction(STORE.RASTERS, 'readwrite');
  const store = tx.objectStore(STORE.RASTERS);
  const existing = await store.get(id);
  if (!existing) {
    await tx.done;
    return null;
  }
  const merged = { ...existing, ...patch, id }; // id is immutable
  await store.put(merged);
  await tx.done;
  return merged;
}

export async function remove(id) {
  const db = await getDb();
  await db.delete(STORE.RASTERS, id);
}

/**
 * List all overlays without their source_blob fields.
 */
export async function listMeta() {
  const db = await getDb();
  const rows = await db.getAll(STORE.RASTERS);
  return rows
    .map(({ source_blob, ...meta }) => meta)
    .sort((a, b) => a.z_order - b.z_order);
}

export async function byLevel(levelId) {
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE.RASTERS, 'by_level', levelId);
  return rows.sort((a, b) => a.z_order - b.z_order);
}

export async function clear() {
  const db = await getDb();
  await db.clear(STORE.RASTERS);
}
