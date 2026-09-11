import { getDB } from './db'

export async function getConfig() {
  const db = await getDB()
  return await db.get('config', 'user') ?? {}
}

export async function saveConfig(values) {
  const db = await getDB()
  await db.put('config', values, 'user')
}

export function isConfigValid(cfg) {
  return (
    typeof cfg.githubRepoUrl === 'string' &&
    cfg.githubRepoUrl.startsWith('https://github.com/') &&
    typeof cfg.proxyUrl === 'string' &&
    cfg.proxyUrl.startsWith('https://') &&
    typeof cfg.proxyToken === 'string' &&
    cfg.proxyToken !== ''
  )
}
