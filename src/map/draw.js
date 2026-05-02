// Awaitable Geoman draw helpers. Wraps the imperative Geoman draw API
// (enableMode('draw', 'polygon') + 'gm:create' event) in a Promise that
// resolves with the drawn GeoJSON geometry, or null if the user cancels.
//
// Geoman free 0.7.x emits a 'gm:create' event on the map when the user
// finishes drawing. The event payload is { feature, featureData } where
// featureData is the same handle returned from importGeoJsonFeature.
// We immediately delete the temporary Geoman feature — the wizard only
// wants the geometry to write into its own feature row.
//
// Snapping: Geoman's snap helper only sees features in the gm_main source.
// Since we delete our drawn features after capture, callers must pass
// `snapTargets` (an array of GeoJSON geometries) for each draw — we
// briefly import them into gm_main so snapping has something to grab,
// and remove them again when the draw ends.

import { addPolygonFeature, removePolygonFeature, setClickToSelectEnabled } from './geoman.js';

/**
 * Wait for the user to draw a polygon. Returns the GeoJSON Polygon
 * geometry, or null if cancelled. Cancel handler is exposed via
 * `cancel()` on the returned controller — call it from your floating
 * UI's "Cancel" button.
 *
 * @param {object} map        MapLibre map with Geoman attached.
 * @param {object} [options]
 * @param {Array<{type: string, coordinates: any}>} [options.snapTargets]
 *        Geometries from previously-saved features to use as snap
 *        anchors. They are imported into gm_main for the duration of
 *        the draw and removed when it ends.
 *
 * Usage:
 *   const ctl = drawPolygon(map, { snapTargets: [footprintGeom] });
 *   cancelBtn.onclick = () => ctl.cancel();
 *   const geometry = await ctl.promise;   // null on cancel
 */
export function drawPolygon(map, options = {}) {
  return drawShape(map, 'polygon', options);
}

export function drawPoint(map, options = {}) {
  return drawShape(map, 'point', options);
}

// Geoman event names have drifted across versions; listen to all the
// plausible ones for "draw finished" so we don't miss the resolution.
const CREATE_EVENTS = ['gm:create', 'gm:drawend', 'pm:create'];

function drawShape(map, shape, { snapTargets = [] } = {}) {
  let cleanup = () => {};
  const snapFeatures = []; // FeatureData handles for the snap-target imports
  const snapIds = new Set(); // ids we own — ignore gm:create for these

  const promise = new Promise((resolve) => {
    let resolved = false;
    let escapeHandler = null;

    const onCreate = async (ev) => {
      if (resolved) return;
      const featureData = ev?.featureData ?? ev?.feature?.featureData ?? ev?.feature;
      // Snap-target imports also dispatch through this event in some Geoman
      // builds — ignore them so we only resolve on the user's own draw.
      const fdId = featureData?.id ?? ev?.feature?.id ?? null;
      if (fdId !== null && snapIds.has(fdId)) return;

      let geometry = null;
      try {
        if (featureData?.getGeoJson) {
          geometry = featureData.getGeoJson()?.geometry ?? null;
        } else if (ev?.feature?.geometry) {
          geometry = ev.feature.geometry;
        } else if (ev?.geometry) {
          geometry = ev.geometry;
        }
      } catch (err) {
        console.warn('drawShape: failed reading geometry', err);
      }

      // Remove the temporary Geoman feature; the wizard renders its own.
      try {
        if (featureData?.delete) await featureData.delete();
        else if (featureData?.id && map.gm?.features?.delete) {
          await map.gm.features.delete(featureData.id);
        }
      } catch { /* ignore — best effort */ }

      finalize(geometry);
    };

    const finalize = async (geometry) => {
      if (resolved) return;
      resolved = true;
      for (const name of CREATE_EVENTS) map.off(name, onCreate);
      if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
      try {
        if (map.gm?.options?.isModeEnabled?.('draw', shape)) {
          await map.gm.options.disableMode('draw', shape);
        }
      } catch { /* ignore */ }
      // Remove snap targets we added for this draw so the next draw starts clean.
      for (const fd of snapFeatures) {
        await removePolygonFeature(map, fd);
      }
      setClickToSelectEnabled(true);
      resolve(geometry);
    };

    cleanup = () => finalize(null);

    escapeHandler = (e) => { if (e.key === 'Escape') finalize(null); };
    document.addEventListener('keydown', escapeHandler);

    for (const name of CREATE_EVENTS) map.on(name, onCreate);
    setClickToSelectEnabled(false);

    // Kick off the draw mode. Defer with a microtask so listeners attach first.
    Promise.resolve().then(async () => {
      if (resolved) return;
      try {
        if (!map.gm?.options) {
          console.warn('drawShape: Geoman not attached on map');
          finalize(null);
          return;
        }

        // Import snap targets into gm_main so Geoman's snapping helper can
        // see them. We track ids so onCreate can ignore the import events.
        for (const target of snapTargets) {
          if (!target?.coordinates) continue;
          try {
            const fd = await addPolygonFeature(map, {
              type: 'Feature', properties: {}, geometry: target,
            });
            if (fd) {
              snapFeatures.push(fd);
              if (fd.id !== undefined && fd.id !== null) snapIds.add(fd.id);
            }
          } catch (err) {
            console.warn('drawShape: failed to import snap target', err);
          }
        }

        // Snapping helps keep adjacent rooms aligned without manual care.
        try {
          if (!map.gm.options.isModeEnabled?.('helper', 'snapping')) {
            await map.gm.options.enableMode('helper', 'snapping');
          }
        } catch { /* helper not present in this build — proceed without */ }
        await map.gm.options.enableMode('draw', shape);
      } catch (err) {
        console.warn('drawShape: enableMode failed', err);
        finalize(null);
      }
    });
  });

  return {
    promise,
    cancel: () => cleanup(),
  };
}
