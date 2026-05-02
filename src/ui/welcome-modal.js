// Startup screen: choose between "Create new IMDF map" and
// "Import existing IMDF (.zip)". Resolves with the user's choice.

import { showModal } from './wizard/forms.js';

/**
 * @returns {Promise<'create' | 'import'>}
 */
export async function showWelcomeModal() {
  const result = await showModal({
    title: 'Welcome to IMDF Editor',
    intro: 'Start by creating a new IMDF map from scratch, or import an existing IMDF ZIP to view or update it.',
    fields: [],
    actions: [
      { id: 'import', label: 'Import existing IMDF (.zip)', validate: false },
      { id: 'create', label: 'Create new IMDF map', primary: true, validate: false },
    ],
    dismissable: false,
  });
  return result?.actionId === 'import' ? 'import' : 'create';
}
