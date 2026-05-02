// Curated subsets of IMDF category vocabularies for the v1 creation wizard.
// The full vocabularies live in `src/imdf/schema.js`; the wizard exposes a
// small, sane set in dropdowns to keep the creation flow approachable. Power
// users can pick any value from the full list via the post-creation property
// panel (`src/ui/property-panel.js`).

import {
  VENUE_CATEGORY, BUILDING_CATEGORY, LEVEL_CATEGORY, UNIT_CATEGORY,
} from '../../imdf/schema.js';

const pick = (full, values) => values
  .map((v) => full.find((opt) => opt.value === v))
  .filter(Boolean);

export const VENUE_CATEGORIES = pick(VENUE_CATEGORY, [
  'businesscampus', 'education', 'healthcare', 'retail', 'transit',
  'unspecified',
]);

export const BUILDING_CATEGORIES = pick(BUILDING_CATEGORY, [
  'unspecified',
]);

// Footprint category is fixed for v1 — the wizard auto-creates a single
// ground polygon. The property panel exposes 'aerial' / 'subterranean' for
// imported data.
export const FOOTPRINT_CATEGORY = 'ground';

export const LEVEL_CATEGORIES = pick(LEVEL_CATEGORY, [
  'unspecified',
]);

export const UNIT_CATEGORIES = pick(UNIT_CATEGORY, [
  'room', 'hallway', 'walkway', 'elevator', 'stairs', 'restroom', 'lobby',
  'unspecified',
]);
