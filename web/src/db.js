import { openDB } from 'idb'

// Single shared connection promise — opened once, reused by every caller.
let _dbPromise = null

export const getDB = () => {
  if (!_dbPromise) {
    _dbPromise = openDB('jade-lens', 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore('config')
        if (oldVersion < 2) db.createObjectStore('repo')
        if (oldVersion < 3) db.createObjectStore('sync')
        // Editing-session drafts (Phase 5b), keyed by their own `id`.
        if (oldVersion < 4) db.createObjectStore('drafts', { keyPath: 'id' })
      },
    })
  }
  return _dbPromise
}
