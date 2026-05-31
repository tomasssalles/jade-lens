import { openDB } from 'idb'

export const getDB = () => openDB('jade-lens', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('config')
    if (oldVersion < 2) db.createObjectStore('repo')
  }
})
