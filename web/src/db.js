import { openDB } from 'idb'

// Single shared connection promise — opened once, reused by every caller.
let _dbPromise = null

export const getDB = () => {
  if (!_dbPromise) {
    _dbPromise = openDB('jade-lens', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore('config')
        if (oldVersion < 2) db.createObjectStore('repo')
      },
    })
  }
  return _dbPromise
}
