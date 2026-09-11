import { getDB } from './db'

// Pre-fills Settings with the dev proxy config on first load.
// Only runs in dev mode — dead code (and tree-shaken) in production builds.
export async function seedDevConfig() {
  if (!import.meta.env.DEV) return
  const githubRepoUrl = import.meta.env.VITE_JL_E2E_REPO_URL
  const proxyUrl = import.meta.env.VITE_PROXY_URL
  const proxyToken = import.meta.env.VITE_PROXY_TOKEN
  if (!githubRepoUrl || !proxyUrl || !proxyToken) return

  const db = await getDB()
  const existing = await db.get('config', 'user') ?? {}
  if (existing.githubRepoUrl && existing.proxyUrl && existing.proxyToken) return

  await db.put('config', { ...existing, githubRepoUrl, proxyUrl, proxyToken }, 'user')
}
