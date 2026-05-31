import { getDB } from './db'

export async function getCachedRepo() {
  const db = await getDB()
  return (await db.get('repo', 'data')) ?? null
}

export function setCachedRepo(data) {
  return getDB().then(db => db.put('repo', data, 'data')).catch(() => {})
}
