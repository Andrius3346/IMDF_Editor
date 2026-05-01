// ZIP -> IndexedDB.
// Unzips an IMDF archive, parses manifest.json + each <feature_type>.geojson,
// and writes everything into the database. Optionally clears existing data
// first (replace mode).

import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8';
import { clearAll } from '../storage/db.js';
import { bulkPut, FEATURE_TYPES } from '../storage/features.js';
import { setManifest, setMapName, markImported, stampSchemaVersion } from '../storage/manifest.js';

/**
 * @param {File|Blob|ArrayBuffer|Uint8Array} input  IMDF zip archive
 * @param {{ replace?: boolean, mapName?: string }} [opts]
 * @returns {Promise<{ featuresImported: number, perType: Record<string, number>, manifest: object|null, warnings: string[] }>}
 */
export async function importZip(input, opts = {}) {
  const { replace = true, mapName } = opts;

  const bytes = await toUint8(input);
  const archive = unzipSync(bytes);
  const warnings = [];

  // Index entries by their basename (ignore folders inside the zip).
  // Some archives wrap files in a top-level folder — we accept either.
  const entries = {};
  for (const path in archive) {
    const base = path.split('/').pop();
    if (!base) continue;                        // directory entry
    if (entries[base]) {
      warnings.push(`Duplicate entry for "${base}" — using the last one.`);
    }
    entries[base] = archive[path];
  }

  // Parse manifest first so we can fail fast on a malformed archive.
  if (!entries['manifest.json']) {
    throw new Error('Not an IMDF archive: manifest.json is missing.');
  }
  /** @type {object} */
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
  } catch (e) {
    throw new Error(`manifest.json is not valid JSON: ${e.message}`);
  }

  // Parse and group features before we touch the DB, so a parse failure
  // doesn't leave the DB half-cleared.
  const grouped = {};
  let total = 0;
  for (const featureType of FEATURE_TYPES) {
    const filename = `${featureType}.geojson`;
    const entry = entries[filename];
    if (!entry) {
      grouped[featureType] = [];
      continue;
    }
    let fc;
    try {
      fc = JSON.parse(strFromU8(entry));
    } catch (e) {
      throw new Error(`${filename} is not valid JSON: ${e.message}`);
    }
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error(`${filename} is not a GeoJSON FeatureCollection.`);
    }
    // Force feature_type from the filename so a typo in the file can't lie.
    const features = fc.features.map((f) => ({
      ...f,
      feature_type: featureType,
    }));
    grouped[featureType] = features;
    total += features.length;
  }

  if (replace) await clearAll();

  await setManifest(manifest);
  if (mapName) await setMapName(mapName);
  await stampSchemaVersion();
  await markImported();

  const perType = {};
  for (const featureType of FEATURE_TYPES) {
    const features = grouped[featureType];
    if (features.length > 0) await bulkPut(features);
    perType[featureType] = features.length;
  }

  return { featuresImported: total, perType, manifest, warnings };
}

async function toUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError('importZip: expected File, Blob, ArrayBuffer, or Uint8Array.');
}
