// Click handler for the IMDF features source. Lets the user pick a
// rendered feature (footprint / venue polygon / level outline / unit
// polygon / address dot) and open the property panel for it.
//
// This is separate from the Geoman click handler in geoman.js — Geoman
// only sees its own gm_main source. If a click hits a gm_ feature we let
// Geoman handle it; if it hits an imdf-features feature we open the
// property panel; if it misses everything we close the panel.

import { SOURCE_ID } from './features-layer.js';
import { showFeatureForEdit, hidePropertyPanel, getCurrentFeatureId } from '../ui/property-panel.js';

let enabled = true;

export function installFeatureSelect(map) {
  map.on('click', (ev) => {
    if (!enabled) return;
    // The wizard drives its own flow — don't pop the property panel
    // mid-creation. (The wizard still benefits from the underlying
    // selection state for visual feedback.)
    if (document.body.classList.contains('wizard-active')) return;

    const hits = map.queryRenderedFeatures(ev.point);

    const gmHit = hits.find(
      (f) => typeof f.source === 'string' && f.source.startsWith('gm_'),
    );
    if (gmHit) return; // Geoman's own handler will deal with it.

    const imdfHit = hits.find((f) => f.source === SOURCE_ID);
    if (imdfHit) {
      const id = imdfHit.properties?.id;
      if (id) showFeatureForEdit(id);
      return;
    }

    if (getCurrentFeatureId()) hidePropertyPanel();
  });

  // Cursor affordance over IMDF features.
  for (const layerId of [
    'imdf-footprint-fill', 'imdf-level-fill', 'imdf-unit-fill',
    'imdf-venue-line',
  ]) {
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }
}

export function setFeatureSelectEnabled(value) {
  enabled = !!value;
}
