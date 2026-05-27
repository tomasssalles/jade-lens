// Parse `https://github.com/<owner>/<repo>` (tolerates trailing `/` and
// `.git`). Returns `{ owner, repo }` or `null` if it can't be parsed.
function parseRepoUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function ghFetch(path, pat) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  })
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

// Fetch the full recursive file tree for the repo's default branch.
// Returns `{ items, branch, truncated }`.
export async function getRepoTree(repoUrl, pat) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('Could not parse repo URL')
  const { owner, repo } = parsed

  const repoRes = await ghFetch(`/repos/${owner}/${repo}`, pat)
  if (!repoRes.ok) throw new Error(`GitHub returned ${repoRes.status}`)
  const { default_branch } = await repoRes.json()

  const treeRes = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${default_branch}?recursive=1`,
    pat,
  )
  if (!treeRes.ok) throw new Error(`GitHub returned ${treeRes.status}`)
  const { tree, truncated } = await treeRes.json()
  return { items: tree, branch: default_branch, truncated }
}

// Fetch the text content of a single file. Returns a string.
export async function getFileContent(repoUrl, pat, path) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('Could not parse repo URL')
  const { owner, repo } = parsed

  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, pat)
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  const data = await res.json()

  if (data.encoding !== 'base64') throw new Error('Unexpected encoding: ' + data.encoding)
  const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}