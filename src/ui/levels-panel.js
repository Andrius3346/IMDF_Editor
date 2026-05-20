// Sidebar list of levels. Each row has a radio (active level) and an
// eye-toggle (hide its features on the map). The picker drives both the
// is_active dimming and the is_hidden filtering in src/map/features-layer.js.
//
// Scope: the picker only affects level features and features carrying a
// level_id (currently unit and opening). Venue, building, footprint, etc.
// always render regardless of picker state — see isHidden() in features-layer.

import * as features from '../storage/features.js';
import { setActiveLevel, setHiddenLevels } from '../map/features-layer.js';

const $ = (id) => document.getElementById(id);

let mounted = null;
let activeLevelId = null;
const hiddenLevelIds = new Set();
let cachedLevels = [];

export function mountLevelsPanel({ map }) {
  mounted = { map };
  refreshLevelsPanel();
}

export async function refreshLevelsPanel() {
  if (!mounted) return;
  const list = $('level-list');
  const section = $('levels-section');
  if (!list || !section) return;

  const rows = await features.byType('level');
  // Sort by ordinal ascending; ties by row id for stability.
  cachedLevels = rows.slice().sort((a, b) => {
    const oa = a.properties?.ordinal ?? 0;
    const ob = b.properties?.ordinal ?? 0;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });

  const hasLevels = cachedLevels.length > 0;
  document.body.classList.toggle('has-levels', hasLevels);
  section.hidden = !hasLevels;

  // Sync visibility of the sidebar with the shared rule (either has-overlays
  // or has-levels keeps it open).
  const sidebar = $('sidebar');
  if (sidebar) {
    const shouldShow = hasLevels || document.body.classList.contains('has-overlays');
    sidebar.hidden = !shouldShow;
    sidebar.style.display = shouldShow ? '' : 'none';
  }

  // Reconcile state against the current level set.
  const validIds = new Set(cachedLevels.map((r) => r.id));
  for (const id of [...hiddenLevelIds]) {
    if (!validIds.has(id)) hiddenLevelIds.delete(id);
  }
  if (activeLevelId && !validIds.has(activeLevelId)) activeLevelId = null;
  if (!activeLevelId && cachedLevels.length > 0) activeLevelId = cachedLevels[0].id;

  list.innerHTML = '';
  for (const row of cachedLevels) {
    list.appendChild(renderRow(row));
  }

  applyToMap();
}

function renderRow(row) {
  const li = document.createElement('li');
  li.className = 'level-row';
  if (hiddenLevelIds.has(row.id)) li.classList.add('hidden-level');
  li.dataset.id = row.id;

  const label = document.createElement('label');
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'active-level';
  radio.value = row.id;
  radio.checked = row.id === activeLevelId;
  radio.onchange = () => {
    if (radio.checked) {
      activeLevelId = row.id;
      applyToMap();
    }
  };
  const span = document.createElement('span');
  span.className = 'level-label';
  span.textContent = labelFor(row);
  label.append(radio, span);

  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'visibility';
  const hidden = hiddenLevelIds.has(row.id);
  eye.textContent = hidden ? '⌀' : '\u{1F441}';
  eye.title = hidden ? 'Show this level' : 'Hide this level';
  eye.setAttribute('aria-pressed', String(!hidden));
  eye.onclick = () => {
    if (hiddenLevelIds.has(row.id)) hiddenLevelIds.delete(row.id);
    else hiddenLevelIds.add(row.id);
    refreshLevelsPanel();
  };

  li.append(label, eye);
  return li;
}

// Mirror of refRowLabel in property-panel.js: prefer name.en, then any
// localized name, then ordinal, then a uuid prefix. Inlined here to keep
// the import graph simple.
function labelFor(row) {
  const p = row.properties || {};
  if (p.name?.en) return p.name.en;
  const localized = p.name && typeof p.name === 'object' ? Object.values(p.name)[0] : null;
  if (localized) return localized;
  if (typeof p.ordinal === 'number') return `Floor ${p.ordinal}`;
  return row.id.slice(0, 8);
}

function applyToMap() {
  if (!mounted?.map) return;
  setActiveLevel(mounted.map, activeLevelId);
  setHiddenLevels(mounted.map, hiddenLevelIds);
}
