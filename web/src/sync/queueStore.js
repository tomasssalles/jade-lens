// Storage port for the operation queue (Phase 1 of
// docs/mutation-sync-implementation-plan.md).
//
// The queue's logic (opQueue.js) is written against this tiny async port so it
// can be unit-tested without a browser. The whole sync state is a single record
// — load it, mutate, save it back — which makes the post-push base-advance
// inherently atomic (one record write = one IndexedDB transaction; see
// docs/sync-and-conflicts.md §6).
//
//   interface QueueStore {
//     load(): Promise<State | undefined>   // the saved state, or undefined if none
//     save(state: State): Promise<void>    // persist the whole state atomically
//   }
//
// `State` (see opQueue.js) carries `Map` values (baseMap, workingMap). Both
// adapters must give callers an isolated copy on every load/save so a caller
// holding a returned state can't mutate what's stored by reference — IndexedDB's
// structured clone does this for free; the in-memory adapter clones explicitly.

const STATE_KEY = 'state';

/**
 * In-memory QueueStore for tests (and any non-persistent caller). Clones on the
 * way in and out via structuredClone — which handles `Map` — to mirror the
 * structured-clone isolation an IndexedDB-backed store provides.
 *
 * @returns {{load: () => Promise<object|undefined>, save: (state: object) => Promise<void>}}
 */
export function createMemoryQueueStore() {
  let stored; // undefined until first save
  return {
    async load() {
      return stored === undefined ? undefined : structuredClone(stored);
    },
    async save(state) {
      stored = structuredClone(state);
    },
  };
}

export { STATE_KEY };
