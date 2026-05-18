// Click-to-pick helper for IMDF features rendered by features-layer.js. Used
// by the wizard's relationship step: after drawing an opening, ask the user
// to click two on-map features (typically the units the opening sits
// between). Resolves with `{ id, feature_type }` or null on Escape.
//
// The Geoman click-to-select handler runs on every map click, so we disable
// it while a pick session is live — otherwise the pick click would also
// open the property panel for the clicked feature.

import { setClickToSelectEnabled } from './geoman.js';
import { setFeatureSelectEnabled } from './feature-select.js';

const PICKABLE_LAYERS = [
  'imdf-unit-fill',
  'imdf-opening-line',
];

/**
 * Wait for the user to click a feature on the map.
 *
 * @param {object} map           MapLibre map with features-layer mounted.
 * @param {object} options
 * @param {string[]} options.types  feature_type values to accept (others are ignored).
 * @returns {Promise<{ id: string, feature_type: string } | null>}
 */
export function pickFeature(map, { types }) {
  return new Promise((resolve) => {
    setClickToSelectEnabled(false);
    setFeatureSelectEnabled(false);

    const onClick = (ev) => {
      const layers = PICKABLE_LAYERS.filter((id) => map.getLayer(id));
      const hits = layers.length
        ? map.queryRenderedFeatures(ev.point, { layers })
        : [];
      const hit = hits.find((f) => types.includes(f.properties.feature_type));
      if (!hit) return; // stray click — let the user try again
      cleanup();
      resolve({
        id: hit.properties.id,
        feature_type: hit.properties.feature_type,
      });
    };

    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    };

    function cleanup() {
      map.off('click', onClick);
      document.removeEventListener('keydown', onKey);
      setClickToSelectEnabled(true);
      setFeatureSelectEnabled(true);
    }

    map.on('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}
