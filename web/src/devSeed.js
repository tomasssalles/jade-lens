import { getDB } from './db'

// Pre-fills Settings with the e2e test repo config on first load.
// Only runs in dev mode — dead code (and tree-shaken) in production builds.
export async function seedDevConfig() {
  if (!import.meta.env.DEV) return
  const repoUrl = import.meta.env.VITE_JL_E2E_REPO_URL
  const pat = import.meta.env.VITE_JL_E2E_PAT
  if (!repoUrl || !pat) return

  const db = await getDB()
  const existing = await db.get('config', 'user') ?? {}
  if (existing.githubRepoUrl && existing.githubPat) return

  await db.put('config', { ...existing, githubRepoUrl: repoUrl, githubPat: pat }, 'user')
}
