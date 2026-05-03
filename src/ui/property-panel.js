// Schema-driven property editor for the 6 wizard-used IMDF feature types.
// Two modes:
//   - edit:   click an imdf-feature on the map → side panel opens with full
//             IMDF schema + Save/Cancel/Delete actions; stays open across
//             saves so the user can iterate.
//   - wizard: the creation wizard pre-creates a stub row and hands it to
//             showFeatureForWizard(); the panel renders the same schema
//             but with a step header + Cancel/{primaryLabel} actions, and
//             returns a Promise that resolves on save or null on cancel.

import * as features from '../storage/features.js';
import { schemaFor } from '../imdf/schema.js';
import { renderField, collectAndValidate } from './wizard/forms.js';
import { polygonCentroid } from './wizard/geom-utils.js';
import { setSelectedFeature } from '../map/features-layer.js';

const PANEL_ID = 'property-panel';

let mounted = null; // { map, refreshAll }
let currentFeatureId = null;
// Set when the panel is in wizard mode. Holds the abort callback that the
// pp-close button, the Esc key, and the Cancel action should all call.
let activeWizardCancel = null;

export function mountPropertyPanel({ map, refreshAll }) {
  mounted = { map, refreshAll };
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panel.classList.add('property-panel');
  panel.innerHTML = `
    <div class="pp-header">
      <h2 class="pp-title">Properties</h2>
      <button type="button" class="pp-close" title="Close">×</button>
    </div>
    <div class="pp-body"></div>
    <div class="pp-actions" hidden></div>
  `;
  panel.querySelector('.pp-close').onclick = () => {
    if (activeWizardCancel) activeWizardCancel();
    else hidePropertyPanel();
  };
  // Note: Esc is intentionally NOT bound to cancel. Wizard steps wrote
  // a stub row that Cancel removes, so the user must click Cancel
  // explicitly — matching the old `dismissable: false` modal behavior.
  hidePropertyPanel();
}

export function hidePropertyPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panel.classList.remove('open');
  panel.querySelector('.pp-body').innerHTML = '';
  panel.querySelector('.pp-actions').hidden = true;
  panel.querySelector('.pp-actions').innerHTML = '';
  panel.querySelector('.pp-step-header')?.remove();
  currentFeatureId = null;
  activeWizardCancel = null;
  if (mounted?.map) setSelectedFeature(mounted.map, null);
}

// ---------------------------------------------------------------------------
// Edit mode (post-creation editor)
// ---------------------------------------------------------------------------

export async function showFeatureForEdit(featureId) {
  if (!mounted) return;
  const row = await features.get(featureId);
  if (!row) {
    console.warn('Property panel: feature not found', featureId);
    return;
  }
  currentFeatureId = featureId;
  activeWizardCancel = null;
  setSelectedFeature(mounted.map, featureId);

  const panel = openPanel();
  removeStepHeader(panel);
  setTitle(panel, row);

  const handles = await renderBody(panel, row);
  if (!handles) return; // raw-JSON fallback

  const { fields, fieldEls } = handles;
  setActions(panel, [
    { label: 'Delete', className: 'pp-delete', onClick: async () => {
        if (!confirm(`Delete this ${row.feature_type}? This cannot be undone.`)) return;
        await features.remove(row.id);
        hidePropertyPanel();
        await mounted.refreshAll?.();
      } },
    { spacer: true },
    { label: 'Cancel', className: 'pp-cancel', onClick: () => hidePropertyPanel() },
    { label: 'Save', className: 'pp-save primary', onClick: async () => {
        const result = collectAndValidate(fields, fieldEls);
        if (!result.ok) return;
        const cleanProps = stripEmpty(result.values);
        const passthrough = preserveNonFormProps(row.properties, fields);
        const merged = { ...passthrough, ...cleanProps };
        const updated = { ...row, properties: merged, level_id: merged.level_id ?? null };
        await features.put(updated);
        await mounted.refreshAll?.();
        await showFeatureForEdit(row.id); // re-render with saved state
      } },
  ]);
}

// ---------------------------------------------------------------------------
// Wizard mode
// ---------------------------------------------------------------------------

/**
 * Open the panel in wizard mode for a stub feature row. Resolves with
 * `{ saved: true }` when the user clicks the primary action, or `null`
 * when the user cancels (× close icon).
 *
 * @param {object} opts
 * @param {string} opts.featureId
 * @param {{ current:number, total:number, title:string, intro?:string }} opts.step
 * @param {string} [opts.primaryLabel='Continue']
 * @param {string[]} [opts.hideFields] Schema field names to omit from the
 *   wizard form (e.g. ['building_ids'] — set by the wizard's parent step,
 *   not user-editable). Existing values for these fields on the stub row
 *   are preserved through save automatically. Post-creation editor still
 *   shows the full schema.
 * @param {() => any} [opts.onCancel] Called BEFORE the Promise resolves null;
 *   wizard uses it to remove the stub row. Cancel routes through the
 *   panel's × close icon (Esc is not bound — matches the old
 *   wizard's `dismissable: false` modals).
 * @returns {Promise<{ saved: true } | null>}
 */
export async function showFeatureForWizard({
  featureId, step, primaryLabel = 'Continue', hideFields = [], onCancel,
}) {
  if (!mounted) return null;
  const row = await features.get(featureId);
  if (!row) {
    console.warn('Wizard panel: stub feature not found', featureId);
    return null;
  }
  currentFeatureId = featureId;
  setSelectedFeature(mounted.map, featureId);

  const panel = openPanel();
  setStepHeader(panel, step);
  setTitle(panel, row);

  const handles = await renderBody(panel, row, { hideFields });
  // Wizard always operates on schema-known types; if there's no schema we
  // shouldn't be in wizard mode for that type. Fall through gracefully.
  if (!handles) return null;
  const { fields, fieldEls } = handles;

  return new Promise((resolve) => {
    const cancel = async () => {
      activeWizardCancel = null;
      try { await onCancel?.(); } finally {
        hidePropertyPanel();
        resolve(null);
      }
    };
    activeWizardCancel = cancel;

    setActions(panel, [
      { label: primaryLabel, className: 'pp-save primary', onClick: async () => {
          const result = collectAndValidate(fields, fieldEls);
          if (!result.ok) return;
          const cleanProps = stripEmpty(result.values);
          const passthrough = preserveNonFormProps(row.properties, fields);
          const merged = { ...passthrough, ...cleanProps };
          const updated = {
            ...row,
            properties: merged,
            level_id: merged.level_id ?? null,
          };
          await features.put(updated);
          activeWizardCancel = null;
          hidePropertyPanel();
          await mounted.refreshAll?.();
          resolve({ saved: true });
        } },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Shared rendering primitives
// ---------------------------------------------------------------------------

function openPanel() {
  const panel = document.getElementById(PANEL_ID);
  panel.classList.add('open');
  return panel;
}

function setTitle(panel, row) {
  panel.querySelector('.pp-title').textContent =
    `${labelFor(row)}  ·  ${row.feature_type}`;
}

function setStepHeader(panel, step) {
  let header = panel.querySelector('.pp-step-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'pp-step-header';
    panel.insertBefore(header, panel.querySelector('.pp-body'));
  }
  header.innerHTML = '';
  if (step.total) {
    const num = document.createElement('div');
    num.className = 'step-num';
    num.textContent = `Step ${step.current} of ${step.total}`;
    header.appendChild(num);
  }
  const ttl = document.createElement('div');
  ttl.className = 'step-title';
  ttl.textContent = step.title;
  header.appendChild(ttl);
  if (step.intro) {
    const p = document.createElement('p');
    p.className = 'step-intro';
    p.textContent = step.intro;
    header.appendChild(p);
  }
}

function removeStepHeader(panel) {
  panel.querySelector('.pp-step-header')?.remove();
}

async function renderBody(panel, row, { hideFields = [] } = {}) {
  const body = panel.querySelector('.pp-body');
  body.innerHTML = '';
  const schema = schemaFor(row.feature_type);
  if (!schema) {
    renderRawJsonFallback(body, row);
    panel.querySelector('.pp-actions').hidden = true;
    return null;
  }
  const visible = hideFields.length === 0
    ? schema.fields
    : schema.fields.filter((f) => !hideFields.includes(f.name));
  const fields = await Promise.all(visible.map((f) => prepareFieldSpec(f, row)));
  const fieldEls = new Map();
  for (const spec of fields) {
    const el = renderField(spec);
    body.appendChild(el.wrap);
    fieldEls.set(spec.name, el);
  }
  return { fields, fieldEls };
}

function setActions(panel, items) {
  const el = panel.querySelector('.pp-actions');
  el.hidden = false;
  el.innerHTML = '';
  for (const item of items) {
    if (item.spacer) {
      const sp = document.createElement('span');
      sp.className = 'pp-spacer';
      el.appendChild(sp);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = item.className;
    btn.textContent = item.label;
    btn.onclick = item.onClick;
    el.appendChild(btn);
  }
}

async function prepareFieldSpec(field, row) {
  const value = row.properties?.[field.name];
  const spec = { ...field, value };

  if (field.type === 'ref' || field.type === 'ref-multi') {
    const rows = await features.byType(field.refType);
    spec.options = rows.map((r) => ({
      value: r.id,
      label: refRowLabel(r),
    }));
  }
  if (field.type === 'display_point') {
    spec.geometry = row.geometry;
    spec.onRecomputeDisplayPoint = () => {
      const g = row.geometry;
      if (!g) return null;
      if (g.type === 'Polygon') {
        return { type: 'Point', coordinates: polygonCentroid(g.coordinates) };
      }
      if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates?.[0])) {
        return { type: 'Point', coordinates: polygonCentroid(g.coordinates[0]) };
      }
      if (g.type === 'Point') {
        return { type: 'Point', coordinates: g.coordinates.slice() };
      }
      return null;
    };
  }
  return spec;
}

function labelFor(row) {
  const p = row.properties || {};
  if (p.name && typeof p.name === 'object') {
    return p.name.en || Object.values(p.name)[0] || `(${row.feature_type})`;
  }
  if (p.address) return p.address;
  return `(${row.feature_type})`;
}

function refRowLabel(row) {
  const p = row.properties || {};
  if (p.name?.en) return p.name.en;
  if (p.address) return p.address;
  if (typeof p.ordinal === 'number') return `Floor ${p.ordinal}`;
  return row.id.slice(0, 8);
}

/**
 * Properties that exist on the row but aren't owned by any rendered form
 * field (e.g. `display_point`, which the wizard auto-fills from the
 * polygon centroid and the schema doesn't expose). These would otherwise
 * be dropped when the form rebuilds the properties object on save.
 * Callers merge this with their form-collected `cleanProps` so the form
 * fields still take precedence (allowing clears).
 */
function preserveNonFormProps(properties, fields) {
  const formFieldNames = new Set(fields.map((f) => f.name));
  const out = {};
  const props = properties || {};
  for (const k of Object.keys(props)) {
    if (formFieldNames.has(k)) continue;
    const v = props[k];
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Strip null / empty-string / empty-array / empty-object values from a
 * properties object before persisting. IMDF readers don't tolerate
 * `"hours": ""`, and round-trip diffs stay clean.
 */
function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)
        && !('type' in v && 'coordinates' in v) // keep GeoJSON Point
        && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function renderRawJsonFallback(body, row) {
  const note = document.createElement('p');
  note.className = 'pp-note';
  note.textContent = `No editor schema for "${row.feature_type}". Showing raw properties.`;
  body.appendChild(note);

  const pre = document.createElement('pre');
  pre.className = 'pp-json';
  pre.textContent = JSON.stringify(row.properties || {}, null, 2);
  body.appendChild(pre);
}

export function getCurrentFeatureId() {
  return currentFeatureId;
}
