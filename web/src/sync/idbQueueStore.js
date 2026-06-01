// IndexedDB-backed QueueStore adapter (the browser implementation of the port
// defined in queueStore.js). The whole sync state lives under a single key in
// the 'sync' object store, so each save is one structured-clone write — the
// atomic base-advance the design relies on (docs/sync-and-conflicts.md §6).

import { getDB } from '../db.js';
import { STATE_KEY } from './queueStore.js';

const STORE = 'sync';

/**
 * @returns {{load: () => Promise<object|undefined>, save: (state: object) => Promise<void>}}
 */
export function createIdbQueueStore() {
  return {
    async load() {
      const db = await getDB();
      return db.get(STORE, STATE_KEY);
    },
    async save(state) {
      const db = await getDB();
      await db.put(STORE, state, STATE_KEY);
    },
  };
}
