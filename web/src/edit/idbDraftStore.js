// IndexedDB-backed DraftStore adapter (the browser implementation of the port
// defined in draftStore.js). Records live in the 'drafts' object store, keyed by
// their own `id` (keyPath), so `put` needs no out-of-line key.

import { getDB } from '../db.js';

const STORE = 'drafts';

/**
 * @returns {{get: (id: string) => Promise<object|undefined>,
 *            getAll: () => Promise<object[]>,
 *            put: (draft: object) => Promise<void>,
 *            delete: (id: string) => Promise<void>}}
 */
export function createIdbDraftStore() {
  return {
    async get(id) {
      return (await getDB()).get(STORE, id);
    },
    async getAll() {
      return (await getDB()).getAll(STORE);
    },
    async put(draft) {
      await (await getDB()).put(STORE, draft);
    },
    async delete(id) {
      await (await getDB()).delete(STORE, id);
    },
  };
}
