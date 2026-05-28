import { openDB } from 'idb'

export const getDB = () => openDB('jade-lens', 1, {
  upgrade(db) {
    db.createObjectStore('config')
  },
})
