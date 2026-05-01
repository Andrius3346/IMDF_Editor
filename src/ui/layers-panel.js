// Sidebar list of overlays. Each row exposes show/hide, opacity, z-order
// reorder, delete, and re-enter-edit-session.

import * as rasters from '../storage/rasters.js';
import {
  setOverlayOpacity, setOverlayVisibility, setOverlayOrder, unmountOverlay,
} from '../map/raster-layers.js';
import { imgDimsFromRow } from '../raster/affine.js';
import { startEditSession, getActiveOverlayId } from './georeference.js';

const $ = (id) => document.getElementById(id);

let mounted = null;
const opacityWriteTimers = new Map(); // overlay id -> setTimeout id

export function mountLayersPanel({ map, refreshAll }) {
  mounted = { map, refreshAll };
  refreshLayersPanel();
}

export async function refreshLayersPanel() {
  if (!mounted) return;
  const list = $('overlay-list');
  const empty = $('overlay-empty');
  if (!list) return;

  const overlays = await rasters.listMeta();
  // Top of the panel = top of the map (highest z_order first).
  const sorted = overlays.slice().sort((a, b) => (b.z_order ?? 0) - (a.z_order ?? 0));

  list.innerHTML = '';
  empty.style.display = sorted.length ? 'none' : '';

  const editingId = getActiveOverlayId();

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const isEditing = row.id === editingId;
    list.appendChild(renderRow(row, {
      isFirst: i === 0,
      isLast: i === sorted.length - 1,
      isEditing,
    }));
  }
}

function renderRow(row, { isFirst, isLast, isEditing }) {
  const li = document.createElement('li');
  li.className = 'overlay-row' + (row.visible === false ? ' hidden-overlay' : '');
  li.dataset.id = row.id;

  const eyeBtn = button('icon', row.visible === false ? '◌' : '●', 'Show/Hide');
  eyeBtn.title = row.visible === false ? 'Show' : 'Hide';
  eyeBtn.onclick = async () => {
    const next = row.visible === false;
    await rasters.update(row.id, { visible: next });
    setOverlayVisibility(mounted.map, row.id, next);
    refreshLayersPanel();
  };

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = row.name + (isEditing ? '  (editing)' : '');
  name.title = isEditing ? 'Edit session active' : 'Click to re-enter edit mode';
  name.onclick = () => reEnterEdit(row.id);

  const controls = document.createElement('div');
  controls.className = 'controls';
  const upBtn = button('icon', '▲', 'Move up');
  upBtn.disabled = isFirst;
  upBtn.onclick = () => moveZ(row.id, +1);
  const downBtn = button('icon', '▼', 'Move down');
  downBtn.disabled = isLast;
  downBtn.onclick = () => moveZ(row.id, -1);
  const trashBtn = button('icon', '🗑', 'Delete');
  trashBtn.onclick = async () => {
    await rasters.remove(row.id);
    unmountOverlay(mounted.map, row.id);
    await mounted.refreshAll?.();
  };
  controls.append(upBtn, downBtn, trashBtn);

  const opacityRow = document.createElement('div');
  opacityRow.className = 'opacity-row';
  const opLabel = document.createElement('span');
  opLabel.textContent = 'Opacity';
  const opInput = document.createElement('input');
  opInput.type = 'range';
  opInput.min = '0';
  opInput.max = '1';
  opInput.step = '0.01';
  opInput.value = String(row.opacity ?? 1);
  const opVal = document.createElement('span');
  opVal.textContent = `${Math.round((row.opacity ?? 1) * 100)}%`;
  opInput.oninput = () => {
    const v = Number(opInput.value);
    opVal.textContent = `${Math.round(v * 100)}%`;
    setOverlayOpacity(mounted.map, row.id, v);
    clearTimeout(opacityWriteTimers.get(row.id));
    opacityWriteTimers.set(row.id, setTimeout(() => {
      rasters.update(row.id, { opacity: v });
    }, 300));
  };
  opacityRow.append(opLabel, opInput, opVal);

  li.append(eyeBtn, name, controls, opacityRow);
  return li;
}

function button(cls, label, ariaLabel) {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.textContent = label;
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

async function moveZ(id, direction) {
  const list = (await rasters.listMeta()).slice().sort((a, b) => (a.z_order ?? 0) - (b.z_order ?? 0));
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return;
  // Direction +1 means "move toward top" in the visible panel, which means a
  // higher z_order. Sorted ascending, that's swapping with the next entry.
  const swapWith = direction > 0 ? idx + 1 : idx - 1;
  if (swapWith < 0 || swapWith >= list.length) return;

  const a = list[idx];
  const b = list[swapWith];
  const az = a.z_order ?? 0;
  const bz = b.z_order ?? 0;
  await rasters.update(a.id, { z_order: bz });
  await rasters.update(b.id, { z_order: az });

  // Apply on the map: layer with higher z_order should sit above lower.
  // moveLayer(layerId, beforeLayerId) places layerId immediately under
  // beforeLayerId; with `undefined` it goes to the top of the stack.
  if (direction > 0) {
    setOverlayOrder(mounted.map, a.id, undefined); // raise a above b
  } else {
    setOverlayOrder(mounted.map, b.id, undefined); // raise b above a
  }
  await mounted.refreshAll?.();
}

async function reEnterEdit(id) {
  if (id === getActiveOverlayId()) return;
  const row = await rasters.get(id);
  if (!row) return;
  const dims = imgDimsFromRow(row) ?? await dimsFromBlob(row.display_blob);
  if (!dims) {
    alert('Could not determine image dimensions for this overlay.');
    return;
  }
  await startEditSession({
    map: mounted.map,
    row,
    imgW: dims.width,
    imgH: dims.height,
    onCommit: () => mounted.refreshAll?.(),
    onCancel: () => mounted.refreshAll?.(),
  });
  refreshLayersPanel();
}

async function dimsFromBlob(blob) {
  if (!blob) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dims;
  } catch {
    return null;
  }
}
