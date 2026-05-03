// Single source of truth for the editor's IMDF property + category vocabulary.
// Sources: IMDF_specification/IMDF_Data_Model_Full.pdf (in-repo) and the
// OGC IMDF Community Standard 20-094 (https://docs.ogc.org/cs/20-094/).

import { COUNTRY_OPTIONS } from '../ui/wizard/iso3166.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

const opt = (v) => ({ value: v, label: humanize(v) });

function humanize(v) {
  // 'restroom.female' → 'Restroom · female'; 'businesscampus' → 'Businesscampus'.
  const [head, tail] = String(v).split('.');
  const cap = head.charAt(0).toUpperCase() + head.slice(1);
  return tail ? `${cap} · ${tail}` : cap;
}

/** RESTRICTION-CATEGORY (2 values, OGC IMDF). */
export const RESTRICTION_CATEGORY = [
  'employeesonly', 'restricted',
].map(opt);

/** VENUE-CATEGORY (22 values, Apple IMDF register). */
export const VENUE_CATEGORY = [
  'airport', 'airport.intl', 'aquarium', 'businesscampus', 'casino',
  'communitycenter', 'conventioncenter', 'governmentfacility',
  'healthcarefacility', 'hotel', 'museum', 'parkingfacility', 'resort',
  'retailstore', 'shoppingcenter', 'stadium', 'stripmall', 'theater',
  'themepark', 'trainstation', 'transitstation', 'university',
].map(opt);

/** BUILDING-CATEGORY (5 values, OGC IMDF). */
export const BUILDING_CATEGORY = [
  'parking', 'transit', 'transit.bus', 'transit.train', 'unspecified',
].map(opt);

/** FOOTPRINT-CATEGORY (3 values, OGC IMDF). */
export const FOOTPRINT_CATEGORY = [
  'aerial', 'ground', 'subterranean',
].map(opt);

/** LEVEL-CATEGORY (9 values, OGC IMDF Community Standard 20-094). */
export const LEVEL_CATEGORY = [
  'arrivals', 'arrivals.domestic', 'arrivals.intl',
  'departures', 'departures.domestic', 'departures.intl',
  'parking', 'transit', 'unspecified',
].map(opt);

/** UNIT-CATEGORY (OGC IMDF Community Standard 20-094). */
export const UNIT_CATEGORY = [
  'auditorium', 'brick', 'classroom', 'column', 'concrete', 'conferenceroom',
  'drywall', 'elevator', 'escalator', 'fieldofplay', 'firstaid', 'fitnessroom',
  'foodservice', 'footbridge', 'glass', 'huddleroom', 'kitchen', 'laboratory',
  'library', 'lobby', 'lounge', 'mailroom', 'mothersroom', 'movietheater',
  'movingwalkway', 'nonpublic', 'office', 'opentobelow', 'parking',
  'phoneroom', 'platform', 'privatelounge', 'ramp', 'recreation', 'restroom',
  'restroom.family', 'restroom.female', 'restroom.female.wheelchair',
  'restroom.male', 'restroom.male.wheelchair', 'restroom.transgender',
  'restroom.transgender.wheelchair', 'restroom.unisex',
  'restroom.unisex.wheelchair', 'restroom.wheelchair', 'road', 'room',
  'serverroom', 'shower', 'smokingarea', 'stairs', 'steps', 'storage',
  'structure', 'terrace', 'theater', 'unenclosedarea', 'unspecified',
  'vegetation', 'waitingroom', 'walkway', 'walkway.island', 'wood',
].map(opt);

/** ACCESSIBILITY-CATEGORY (10 values, OGC IMDF Community Standard 20-094). */
export const ACCESSIBILITY_CATEGORY = [
  'assisted.listening', 'braille', 'hearing', 'hearingloop',
  'signlanginterpreter', 'tactilepaving', 'tdd', 'trs', 'volume', 'wheelchair',
].map(opt);

// ---------------------------------------------------------------------------
// Per-feature-type field schemas
// ---------------------------------------------------------------------------

/**
 * @typedef {object} FieldSchema
 * @property {string}  name
 * @property {'text'|'number'|'select'|'checkbox'|'textarea'|'labels'|'multi-select'|'display_point'|'ref'|'ref-multi'} type
 * @property {string=} label                   // defaults to humanized name
 * @property {boolean=} required
 * @property {{value:string,label:string}[]=} options
 * @property {string=} refType                 // for 'ref' / 'ref-multi'
 * @property {string=} hint
 * @property {string=} placeholder
 * @property {boolean=} allowEmpty             // 'select' types: include "(none)" entry
 * @property {number=} min                     // for 'ref-multi' / 'multi-select'
 * @property {number=} step                    // for 'number'
 */

/** Schemas keyed by feature_type. Drives the property panel renderer. */
export const SCHEMAS = {
  address: {
    label: 'Address',
    fields: [
      { name: 'address',  type: 'text', required: true, label: 'Street address',
        placeholder: 'e.g. Saulėtekio al. 9' },
      { name: 'unit',     type: 'text', label: 'Unit / suite' },
      { name: 'locality', type: 'text', required: true, label: 'City / locality' },
      { name: 'province', type: 'text', label: 'Province (ISO 3166-2)',
        hint: 'Country code + dash + subdivision (LT-VL, US-CA, GB-LND).' },
      { name: 'country',  type: 'select', required: true, options: COUNTRY_OPTIONS,
        label: 'Country (ISO 3166-1)' },
      { name: 'postal_code',        type: 'text', label: 'Postal code' },
      { name: 'postal_code_ext',    type: 'text', label: 'Postal code extension' },
      { name: 'postal_code_vanity', type: 'text', label: 'Postal code (vanity)' },
    ],
  },

  venue: {
    label: 'Venue',
    fields: [
      { name: 'category',    type: 'select', required: true, options: VENUE_CATEGORY },
      { name: 'restriction', type: 'select', options: RESTRICTION_CATEGORY, allowEmpty: true },
      { name: 'name',        type: 'labels', required: true },
      { name: 'alt_name',    type: 'labels', label: 'Alternate name' },
      { name: 'hours',       type: 'text', hint: 'OSM opening_hours format (e.g. "Mo-Fr 08:00-18:00").' },
      { name: 'phone',       type: 'text' },
      { name: 'website',     type: 'text', placeholder: 'https://…' },
      { name: 'address_id',  type: 'ref', refType: 'address', required: true,
        label: 'Address' },
    ],
  },

  footprint: {
    label: 'Footprint',
    fields: [
      { name: 'category',     type: 'select', required: true, options: FOOTPRINT_CATEGORY },
      { name: 'name',         type: 'labels' },
      { name: 'building_ids', type: 'ref-multi', refType: 'building', required: true,
        min: 1, label: 'Buildings' },
    ],
  },

  building: {
    label: 'Building',
    fields: [
      { name: 'name',          type: 'labels' },
      { name: 'alt_name',      type: 'labels', label: 'Alternate name' },
      { name: 'category',      type: 'select', required: true, options: BUILDING_CATEGORY },
      { name: 'restriction',   type: 'select', options: RESTRICTION_CATEGORY, allowEmpty: true },
      { name: 'address_id',    type: 'ref', refType: 'address', label: 'Address' },
    ],
  },

  level: {
    label: 'Level',
    fields: [
      { name: 'category',      type: 'select', options: LEVEL_CATEGORY },
      { name: 'restriction',   type: 'select', options: RESTRICTION_CATEGORY, allowEmpty: true },
      { name: 'outdoor',       type: 'checkbox' },
      { name: 'ordinal',       type: 'number', step: 1,
        hint: '0 = ground, 1 = first floor up, -1 = basement.' },
      { name: 'name',          type: 'labels' },
      { name: 'short_name',    type: 'labels',
        hint: 'Optional short label, e.g. "G", "L1".' },
      { name: 'address_id',    type: 'ref', refType: 'address', label: 'Address' },
      { name: 'building_ids',  type: 'ref-multi', refType: 'building', label: 'Buildings' },
    ],
  },

  unit: {
    label: 'Unit',
    fields: [
      { name: 'category',      type: 'select', required: true, options: UNIT_CATEGORY },
      { name: 'restriction',   type: 'select', options: RESTRICTION_CATEGORY, allowEmpty: true },
      { name: 'accessibility', type: 'multi-select', options: ACCESSIBILITY_CATEGORY },
      { name: 'name',          type: 'labels' },
      { name: 'alt_name',      type: 'labels', label: 'Alternate name' },
      { name: 'level_id',      type: 'ref', refType: 'level', required: true,
        label: 'Level' },
    ],
  },
};

/** Returns the schema for a feature type or undefined. */
export function schemaFor(featureType) {
  return SCHEMAS[featureType];
}
