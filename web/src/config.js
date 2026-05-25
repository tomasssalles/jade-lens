import { getDB } from './db'

export async function getConfig() {
  const db = await getDB()
  return await db.get('config', 'user') ?? {}
}

export async function saveConfig(values) {
  const db = await getDB()
  await db.put('config', values, 'user')
}
