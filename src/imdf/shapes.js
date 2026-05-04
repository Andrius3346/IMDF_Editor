// JSDoc shape definitions for the 16 IMDF feature types and the manifest.
// No runtime code — these typedefs give editor autocomplete without a build step.
// Source: Apple IMDF Data Model spec (see IMDF_specification/IMDF_Data_Model_Full.pdf).

/**
 * @typedef {[number, number]} LngLat            // [longitude, latitude] WGS84
 * @typedef {string} UUID                        // RFC 4122 v4
 * @typedef {string} ISODateTime                 // RFC 3339 / ISO 8601
 * @typedef {string} LanguageTag                 // BCP 47
 */

/**
 * @typedef {(
 *   'venue' | 'address' | 'footprint' | 'building' | 'level' | 'section' |
 *   'unit' | 'opening' | 'fixture' | 'anchor' | 'occupant' | 'amenity' |
 *   'kiosk' | 'detail' | 'geofence' | 'relationship'
 * )} FeatureType
 */

/**
 * GeoJSON geometry — one of the RFC 7946 types. IMDF restricts which types
 * each feature_type may use; the editor enforces this at the UI layer.
 * @typedef {object} Geometry
 * @property {string} type                       // 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString' | 'MultiLineString' | ...
 * @property {*} coordinates                     // Per RFC 7946; shape depends on type
 */

/**
 * Generic IMDF feature envelope. Stored in IndexedDB with `level_id` lifted
 * to the top of the row for indexing; on export, the row is projected back to
 * pure RFC 7946 shape (drop level_id, updated_at).
 * @typedef {object} ImdfFeature
 * @property {UUID} id
 * @property {'Feature'} type                    // Always 'Feature' on export
 * @property {FeatureType} feature_type
 * @property {Geometry|null} geometry
 * @property {object} properties                 // Per-type — see typedefs below
 */

// ---------------------------------------------------------------------------
// Manifest (the single non-GeoJSON file in the IMDF ZIP).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Manifest
 * @property {string} version                    // IMDF version, e.g. '1.0.0'
 * @property {ISODateTime} created
 * @property {string=} generated_by
 * @property {LanguageTag} language
 * @property {string[]=} extensions
 */

// ---------------------------------------------------------------------------
// Per-feature property bags.
// Optional fields are marked with `=`. Localized string fields are objects
// keyed by BCP 47 language tag, e.g. { en: 'Lobby', lt: 'Vestibiulis' }.
// ---------------------------------------------------------------------------

/** @typedef {Record<LanguageTag, string>|null} Labels */

/**
 * RESTRICTION-CATEGORY per IMDF spec — a string enum, not a boolean.
 * @typedef {('employeesonly' | 'restricted' | 'unspecified')} RestrictionCategory
 */

/**
 * GeoJSON Point geometry, used for the display_point property on every
 * feature type that carries one. IMDF spec: required on venue, optional
 * elsewhere.
 * @typedef {{ type: 'Point', coordinates: LngLat }} DisplayPoint
 */

/**
 * @typedef {object} VenueProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {Labels} name
 * @property {Labels=} alt_name
 * @property {string=} hours
 * @property {string=} website
 * @property {string=} phone
 * @property {UUID} address_id
 * @property {DisplayPoint=} display_point
 */

/**
 * @typedef {object} AddressProperties
 * @property {string} address                     // Free-form street address
 * @property {string=} unit
 * @property {string=} locality
 * @property {string=} province
 * @property {string=} country
 * @property {string=} postal_code
 * @property {string=} postal_code_ext
 * @property {string=} postal_code_vanity
 */

/**
 * @typedef {object} FootprintProperties
 * @property {string} category                    // 'ground' | 'aerial' | 'subterranean'
 * @property {Labels=} name
 * @property {UUID[]} building_ids
 */

/**
 * @typedef {object} BuildingProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {UUID=} address_id
 * @property {DisplayPoint=} display_point
 */

/**
 * @typedef {object} LevelProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {boolean=} outdoor
 * @property {number} ordinal                     // Floor ordinal, 0 = ground
 * @property {Labels} name
 * @property {Labels} short_name                  // Spec [1..*] — required
 * @property {DisplayPoint=} display_point
 * @property {UUID[]=} building_ids
 * @property {UUID=} address_id
 */

/**
 * @typedef {object} SectionProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {string[]=} accessibility
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID} level_id
 * @property {UUID[]=} parents                    // Section hierarchy
 * @property {UUID=} address_id
 */

/**
 * @typedef {object} UnitProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {string[]=} accessibility
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID} level_id
 */

/**
 * @typedef {object} OpeningProperties
 * @property {string} category
 * @property {string[]=} accessibility
 * @property {string[]=} access_control
 * @property {string[]=} door
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID} level_id
 */

/**
 * @typedef {object} FixtureProperties
 * @property {string} category
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID=} anchor_id
 * @property {UUID} level_id
 */

/**
 * @typedef {object} AnchorProperties
 * @property {UUID} address_id
 * @property {UUID} unit_id
 */

/**
 * @typedef {object} OccupantProperties
 * @property {string} category
 * @property {Labels} name
 * @property {Labels=} short_name
 * @property {string=} hours
 * @property {string=} phone
 * @property {string=} website
 * @property {string=} validity                   // ISO 8601 interval
 * @property {string[]=} correlation_id
 * @property {UUID} anchor_id
 */

/**
 * @typedef {object} AmenityProperties
 * @property {string} category
 * @property {string[]=} accessibility
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {string=} hours
 * @property {string=} phone
 * @property {string=} website
 * @property {UUID[]} unit_ids                    // Required, array
 * @property {string=} correlation_id
 */

/**
 * @typedef {object} KioskProperties
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID=} anchor_id
 * @property {UUID} level_id
 */

/**
 * @typedef {object} DetailProperties
 * @property {UUID} level_id
 */

/**
 * @typedef {object} GeofenceProperties
 * @property {string} category
 * @property {RestrictionCategory=} restriction
 * @property {string[]=} accessibility
 * @property {Labels=} name
 * @property {Labels=} alt_name
 * @property {DisplayPoint=} display_point
 * @property {UUID[]=} building_ids
 * @property {UUID[]=} level_ids                  // Spec: geofences may span levels
 * @property {UUID[]=} parents
 * @property {string=} correlation_id
 */

/**
 * @typedef {object} RelationshipProperties
 * @property {string} category                    // e.g. 'traversal', 'serving'
 * @property {string=} direction                  // 'directed' | 'undirected'
 * @property {{ id: UUID, feature_type: FeatureType }} origin
 * @property {{ id: UUID, feature_type: FeatureType }=} intermediary
 * @property {{ id: UUID, feature_type: FeatureType }} destination
 * @property {object=} hours
 */

// ---------------------------------------------------------------------------
// Editor-side IndexedDB row shapes (not part of the IMDF spec).
// ---------------------------------------------------------------------------

/**
 * Row stored in the `features` object store. `level_id` is denormalized to the
 * top of the row for indexing; on export, project back to RFC 7946 shape.
 * @typedef {object} FeatureRow
 * @property {UUID} id
 * @property {FeatureType} feature_type
 * @property {Geometry|null} geometry
 * @property {object} properties
 * @property {UUID|null} level_id
 * @property {number} updated_at                   // epoch ms
 */

/**
 * Row stored in the `raster_overlays` object store.
 * @typedef {object} RasterOverlayRow
 * @property {UUID} id
 * @property {UUID|null} level_id
 * @property {string} name
 * @property {'png'} source_format
 * @property {Blob} display_blob                   // PNG used for MapLibre
 * @property {{ px: [number, number], lngLat: LngLat }[]} gcps
 * @property {number[]} transform                  // 6-element affine
 * @property {[number, number, number, number]} bounds  // [west, south, east, north]
 * @property {number} opacity                      // 0..1
 * @property {boolean} visible
 * @property {number} z_order
 * @property {number} created_at                   // epoch ms
 */

/**
 * @typedef {object} MetaManifestRow
 * @property {'manifest'} key
 * @property {Manifest} value
 */

/** @typedef {{ key: string, value: * }} MetaRow */

/** @typedef {{ key: string, value: * }} PreferencesRow */

export {}; // ES module marker
