// Modal + form primitives used by the creation wizard and the post-creation
// property panel.
//
// showModal({ title, intro, fields, actions, dismissable }) returns a Promise
// that resolves with { actionId, values } when the user clicks one of the
// action buttons, or `null` if the user cancels (Escape / overlay click) and
// `dismissable !== false`.
//
// renderField / collectValues / collectAndValidate are also exported so the
// property panel can build long-lived forms without going through showModal.

const ROOT_ID = 'modal-root';

function root() {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Render a modal with form fields and action buttons.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.intro]                Plain-text paragraph above fields.
 * @param {FieldSpec[]} [opts.fields]
 * @param {ActionSpec[]} opts.actions          At least one action.
 * @param {boolean} [opts.dismissable=false]   Allow Escape / overlay click to resolve null.
 *
 * @typedef {{ name: string, label?: string,
 *            type?: 'text'|'number'|'select'|'checkbox'|'textarea'|'labels'|'multi-select'|'display_point'|'ref'|'ref-multi',
 *            required?: boolean, value?: any, options?: {value: string, label: string}[],
 *            placeholder?: string, min?: number, max?: number, step?: number, hint?: string,
 *            allowEmpty?: boolean, geometry?: any, refType?: string,
 *            onRecomputeDisplayPoint?: () => any }} FieldSpec
 *
 * @typedef {{ id: string, label: string, primary?: boolean, validate?: boolean }} ActionSpec
 */
export function showModal({ title, intro, fields = [], actions, dismissable = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const h2 = document.createElement('h2');
    h2.textContent = title;
    dialog.appendChild(h2);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (intro) {
      const p = document.createElement('p');
      p.className = 'modal-intro';
      p.textContent = intro;
      body.appendChild(p);
    }

    const fieldEls = new Map();
    for (const spec of fields) {
      const el = renderField(spec);
      body.appendChild(el.wrap);
      fieldEls.set(spec.name, el);
    }
    dialog.appendChild(body);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'modal-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      if (action.primary) btn.className = 'primary';
      btn.onclick = () => {
        if (action.validate !== false) {
          const result = collectAndValidate(fields, fieldEls);
          if (!result.ok) return;
          cleanup();
          resolve({ actionId: action.id, values: result.values });
        } else {
          cleanup();
          resolve({ actionId: action.id, values: collectValues(fields, fieldEls) });
        }
      };
      actionsEl.appendChild(btn);
    }
    dialog.appendChild(actionsEl);

    overlay.appendChild(dialog);

    function cleanup() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    function onKey(ev) {
      if (ev.key === 'Escape' && dismissable) {
        cleanup();
        resolve(null);
      } else if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
        const primary = actions.find((a) => a.primary);
        if (!primary) return;
        ev.preventDefault();
        const result = primary.validate === false
          ? { ok: true, values: collectValues(fields, fieldEls) }
          : collectAndValidate(fields, fieldEls);
        if (!result.ok) return;
        cleanup();
        resolve({ actionId: primary.id, values: result.values });
      }
    }
    document.addEventListener('keydown', onKey);

    if (dismissable) {
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          cleanup();
          resolve(null);
        }
      });
    }

    root().appendChild(overlay);

    const firstInput = dialog.querySelector('input, select, textarea');
    firstInput?.focus();
  });
}

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

const COMMON_LANG_TAGS = ['en', 'lt', 'de', 'fr', 'es', 'it', 'pl', 'ru', 'ja', 'zh', 'ar'];

const SIMPLE_TYPES = new Set(['text', 'number', 'select', 'checkbox', 'textarea']);

/**
 * Render a single form field. Returns a handle:
 *   { wrap, input?, error, getValue(), setValue(v) }
 *
 * Simple types (text/number/select/checkbox/textarea) keep `input` set to
 * the underlying DOM element for back-compat. Complex types (labels,
 * multi-select, ref-multi, display_point) leave `input` undefined.
 */
export function renderField(spec) {
  const wrap = document.createElement('div');
  wrap.className = 'field' + (spec.type === 'checkbox' ? ' field-checkbox' : '');

  const labelText = spec.label || humanizeName(spec.name);
  const label = document.createElement('label');
  label.textContent = labelText;
  if (spec.required) {
    const req = document.createElement('span');
    req.className = 'req';
    req.textContent = '*';
    label.appendChild(req);
  }
  wrap.appendChild(label);

  let handle;
  if (SIMPLE_TYPES.has(spec.type) || !spec.type) {
    handle = renderSimple(spec, wrap);
  } else if (spec.type === 'labels')        handle = renderLabels(spec, wrap);
  else if (spec.type === 'multi-select') handle = renderMultiSelect(spec, wrap);
  else if (spec.type === 'ref')          handle = renderRef(spec, wrap);
  else if (spec.type === 'ref-multi')    handle = renderRefMulti(spec, wrap);
  else if (spec.type === 'display_point') handle = renderDisplayPoint(spec, wrap);
  else handle = renderSimple({ ...spec, type: 'text' }, wrap);

  handle.error = appendHintAndError(spec, wrap);
  return handle;
}

function appendHintAndError(spec, wrap) {
  if (spec.hint) {
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.textContent = spec.hint;
    wrap.appendChild(hint);
  }
  const error = document.createElement('div');
  error.className = 'field-error';
  wrap.appendChild(error);
  return error;
}

function humanizeName(name) {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Simple types (text / number / select / checkbox / textarea) ----------

function renderSimple(spec, wrap) {
  let input;
  if (spec.type === 'select') {
    input = document.createElement('select');
    if (spec.allowEmpty) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '(none)';
      input.appendChild(empty);
    }
    for (const opt of spec.options || []) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      input.appendChild(o);
    }
    if (spec.value !== undefined && spec.value !== null) input.value = String(spec.value);
  } else if (spec.type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
    if (spec.value) input.checked = true;
  } else if (spec.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
    if (spec.value !== undefined) input.value = String(spec.value);
  } else {
    input = document.createElement('input');
    input.type = spec.type || 'text';
    if (spec.placeholder) input.placeholder = spec.placeholder;
    if (spec.type === 'number') {
      if (spec.min !== undefined) input.min = String(spec.min);
      if (spec.max !== undefined) input.max = String(spec.max);
      if (spec.step !== undefined) input.step = String(spec.step);
    }
    if (spec.value !== undefined && spec.value !== null) input.value = String(spec.value);
  }
  input.name = spec.name;
  wrap.appendChild(input);

  return {
    wrap,
    input,
    error: null,
    getValue: () => readSimple(spec, input),
    setValue: (v) => writeSimple(spec, input, v),
  };
}

function readSimple(spec, input) {
  if (spec.type === 'checkbox') return input.checked;
  if (spec.type === 'number') {
    const raw = input.value.trim();
    return raw === '' ? null : Number(raw);
  }
  return input.value.trim();
}

function writeSimple(spec, input, v) {
  if (spec.type === 'checkbox') {
    input.checked = !!v;
    return;
  }
  if (v === null || v === undefined) {
    input.value = '';
    return;
  }
  input.value = String(v);
}

// --- 'labels' type: multi-row { lang, value } editor ----------------------

function renderLabels(spec, wrap) {
  const container = document.createElement('div');
  container.className = 'field-labels';
  wrap.appendChild(container);

  const rows = [];

  function addRow(lang = 'en', value = '') {
    const row = document.createElement('div');
    row.className = 'labels-row';

    const langInput = document.createElement('input');
    langInput.type = 'text';
    langInput.className = 'labels-lang';
    langInput.value = lang;
    langInput.placeholder = 'lang';
    langInput.setAttribute('list', 'common-lang-tags');

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'labels-value';
    valInput.value = value;
    valInput.placeholder = 'value';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.onclick = () => {
      const idx = rows.indexOf(rec);
      if (idx >= 0) rows.splice(idx, 1);
      row.remove();
    };

    row.appendChild(langInput);
    row.appendChild(valInput);
    row.appendChild(removeBtn);
    container.appendChild(row);

    const rec = { row, langInput, valInput };
    rows.push(rec);
  }

  ensureLangDataList();

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'labels-add';
  addBtn.textContent = '+ Add language';
  addBtn.onclick = () => addRow('', '');
  wrap.appendChild(addBtn);

  // Pre-fill from spec.value (Labels object).
  if (spec.value && typeof spec.value === 'object') {
    for (const [lang, val] of Object.entries(spec.value)) addRow(lang, String(val ?? ''));
  }
  // Always have at least one row available for entry.
  if (rows.length === 0) addRow('en', '');

  return {
    wrap,
    error: null,
    getValue() {
      const out = {};
      for (const r of rows) {
        const lang = r.langInput.value.trim();
        const val = r.valInput.value.trim();
        if (lang && val) out[lang] = val;
      }
      return Object.keys(out).length === 0 ? null : out;
    },
    setValue(v) {
      // Wipe existing rows.
      for (const r of rows.slice()) r.row.remove();
      rows.length = 0;
      if (v && typeof v === 'object') {
        for (const [lang, val] of Object.entries(v)) addRow(lang, String(val ?? ''));
      }
      if (rows.length === 0) addRow('en', '');
    },
  };
}

function ensureLangDataList() {
  if (document.getElementById('common-lang-tags')) return;
  const dl = document.createElement('datalist');
  dl.id = 'common-lang-tags';
  for (const tag of COMMON_LANG_TAGS) {
    const o = document.createElement('option');
    o.value = tag;
    dl.appendChild(o);
  }
  document.body.appendChild(dl);
}

// --- 'multi-select' type: checkbox grid -----------------------------------

function renderMultiSelect(spec, wrap) {
  const grid = document.createElement('div');
  grid.className = 'field-multi-select';
  wrap.appendChild(grid);

  const checks = [];
  for (const opt of spec.options || []) {
    const lab = document.createElement('label');
    lab.className = 'multi-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = opt.value;
    if (Array.isArray(spec.value) && spec.value.includes(opt.value)) cb.checked = true;
    lab.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = opt.label;
    lab.appendChild(span);
    grid.appendChild(lab);
    checks.push(cb);
  }

  return {
    wrap,
    error: null,
    getValue() {
      const out = checks.filter((c) => c.checked).map((c) => c.value);
      return out.length === 0 ? null : out;
    },
    setValue(v) {
      const set = new Set(Array.isArray(v) ? v : []);
      for (const c of checks) c.checked = set.has(c.value);
    },
  };
}

// --- 'ref' / 'ref-multi' types --------------------------------------------

function renderRef(spec, wrap) {
  // 'ref' is rendered like a select; the property panel pre-resolves
  // `spec.options` from features.byType(refType).
  return renderSimple({ ...spec, type: 'select', allowEmpty: !spec.required }, wrap);
}

function renderRefMulti(spec, wrap) {
  return renderMultiSelect(spec, wrap);
}

// --- 'display_point' type: read-only point + Recompute button -------------

function renderDisplayPoint(spec, wrap) {
  const container = document.createElement('div');
  container.className = 'field-display-point';
  wrap.appendChild(container);

  let current = spec.value && spec.value.coordinates
    ? { type: 'Point', coordinates: spec.value.coordinates.slice() }
    : null;

  const summary = document.createElement('div');
  summary.className = 'display-point-summary';
  container.appendChild(summary);

  const btnRow = document.createElement('div');
  btnRow.className = 'display-point-actions';
  const recomputeBtn = document.createElement('button');
  recomputeBtn.type = 'button';
  recomputeBtn.textContent = 'Recompute from geometry';
  recomputeBtn.disabled = typeof spec.onRecomputeDisplayPoint !== 'function';
  recomputeBtn.title = recomputeBtn.disabled
    ? 'No polygon geometry available to compute a centroid from.'
    : 'Set display_point to the centroid of the feature polygon.';
  recomputeBtn.onclick = () => {
    const pt = spec.onRecomputeDisplayPoint?.();
    if (pt && Array.isArray(pt.coordinates)) {
      current = { type: 'Point', coordinates: pt.coordinates.slice() };
      render();
    }
  };
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.onclick = () => { current = null; render(); };
  btnRow.appendChild(recomputeBtn);
  btnRow.appendChild(clearBtn);
  container.appendChild(btnRow);

  function render() {
    if (current && Array.isArray(current.coordinates)) {
      const [lng, lat] = current.coordinates;
      summary.textContent = `Point: ${lng.toFixed(6)}, ${lat.toFixed(6)}`;
    } else {
      summary.textContent = '(none)';
    }
  }
  render();

  return {
    wrap,
    error: null,
    getValue: () => current,
    setValue: (v) => {
      current = v && Array.isArray(v.coordinates)
        ? { type: 'Point', coordinates: v.coordinates.slice() }
        : null;
      render();
    },
  };
}

// ---------------------------------------------------------------------------
// Value collection + validation
// ---------------------------------------------------------------------------

export function collectValues(fields, fieldEls) {
  const values = {};
  for (const spec of fields) {
    const handle = fieldEls.get(spec.name);
    values[spec.name] = handle.getValue();
  }
  return values;
}

export function collectAndValidate(fields, fieldEls) {
  let ok = true;
  const values = {};
  for (const spec of fields) {
    const handle = fieldEls.get(spec.name);
    if (handle.error) handle.error.textContent = '';
    let value = handle.getValue();

    // Number parse error surfacing — text input that wasn't blank but didn't parse.
    if (spec.type === 'number' && value !== null && !Number.isFinite(value)) {
      if (handle.error) handle.error.textContent = 'Must be a number.';
      ok = false;
      values[spec.name] = null;
      continue;
    }

    if (spec.required) {
      const empty = isEmpty(spec, value);
      if (empty) {
        if (handle.error) handle.error.textContent = 'Required.';
        ok = false;
      }
    }
    if (spec.type === 'ref-multi' && spec.min && Array.isArray(value) && value.length < spec.min) {
      if (handle.error) handle.error.textContent = `At least ${spec.min} required.`;
      ok = false;
    }
    values[spec.name] = value;
  }
  return { ok, values };
}

function isEmpty(spec, value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && !Array.isArray(value)
      && spec.type !== 'display_point' && spec.type !== 'labels') {
    // Generic object — empty if no own keys.
    return Object.keys(value).length === 0;
  }
  if (spec.type === 'labels' && typeof value === 'object'
      && Object.keys(value).length === 0) {
    return true;
  }
  if (spec.type === 'checkbox' && value === false) return true;
  return false;
}

/**
 * Set an inline error on a field after the modal has already been rendered.
 * Used for cross-field validation (e.g., "ordinal already exists").
 */
export function setFieldError(modalEl, name, message) {
  const wraps = modalEl.querySelectorAll('.field');
  for (const w of wraps) {
    const input = w.querySelector('[name]');
    if (input?.name === name) {
      const err = w.querySelector('.field-error');
      if (err) err.textContent = message || '';
      return;
    }
  }
}
