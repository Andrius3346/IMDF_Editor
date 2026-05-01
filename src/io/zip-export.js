// IndexedDB -> ZIP.
// Reads the manifest and every feature out of IDB, groups features by type,
// emits one <feature_type>.geojson FeatureCollection per type plus
// manifest.json, and zips it all up. Optionally triggers a browser download.

import { zipSync, strToU8 } from 'https://esm.sh/fflate@0.8';
import { byType, toFeature, FEATURE_TYPES } from '../storage/features.js';
import { getManifest, newManifest } from '../storage/manifest.js';

/**
 * Build the zip in memory and return it as a Blob. Does NOT trigger a
 * download — call downloadZip() if that's what you want.
 *
 * @param {{ includeEmptyCollections?: boolean }} [opts]
 *    includeEmptyCollections (default true): emit all 16 geojson files even
 *    when a type has zero features. Some IMDF tooling expects every file to
 *    be present; safer default. Pass false to skip empty types.
 * @returns {Promise<Blob>}
 */
export async function buildZip(opts = {}) {
  const { includeEmptyCollections = true } = opts;

  const manifest = (await getManifest()) ?? newManifest();

  const archive = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  };

  for (const featureType of FEATURE_TYPES) {
    const rows = await byType(featureType);
    if (rows.length === 0 && !includeEmptyCollections) continue;
    const fc = {
      type: 'FeatureCollection',
      features: rows.map(toFeature),
    };
    archive[`${featureType}.geojson`] = strToU8(JSON.stringify(fc, null, 2));
  }

  const bytes = zipSync(archive, { level: 6 });
  return new Blob([bytes], { type: 'application/zip' });
}

/**
 * Build the zip and trigger a browser download.
 * @param {string} [filename] default 'imdf-map.zip'
 * @param {Parameters<typeof buildZip>[0]} [opts]
 */
export async function downloadZip(filename = 'imdf-map.zip', opts) {
  const blob = await buildZip(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { filename, size: blob.size };
}
