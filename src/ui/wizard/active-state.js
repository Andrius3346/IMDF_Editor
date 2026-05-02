// In-memory wizard state. Reset on every page load (the editor is
// session-only — main.js wipes IDB on init).

const initial = () => ({
  step: 'welcome',
  active: false,
  addressId: null,
  venueId: null,
  buildingId: null,
  footprintId: null,
  currentOrdinal: 0,
  currentLevelId: null,
  currentRasterId: null,
});

let state = initial();

export function getState() {
  return state;
}

export function update(patch) {
  state = { ...state, ...patch };
  return state;
}

export function reset() {
  state = initial();
  return state;
}

export function isWizardActive() {
  return state.active;
}
