// Parse `https://github.com/<owner>/<repo>` (tolerates trailing `/` and
// `.git`). Returns `{ owner, repo }` or `null` if it can't be parsed.
function parseRepoUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

// Check that the PAT can reach the configured repo. Returns
// `{ ok: true }` on success, `{ ok: false, reason }` otherwise.
export async function checkRepoAccess(repoUrl, pat) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) return { ok: false, reason: 'Could not parse repo URL' }

  let res
  try {
    res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
      },
    })
  } catch {
    return { ok: false, reason: 'Network error — check your connection' }
  }

  if (res.ok) return { ok: true }
  if (res.status === 401) return { ok: false, reason: 'PAT was rejected by GitHub' }
  if (res.status === 404) return { ok: false, reason: 'Repo not found, or PAT lacks access to it' }
  return { ok: false, reason: `GitHub returned ${res.status}` }
}