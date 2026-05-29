// Parse `https://github.com/<owner>/<repo>` (tolerates trailing `/` and
// `.git`). Returns `{ owner, repo }` or `null` if it can't be parsed.
function parseRepoUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function ghFetch(path, pat) {
  const headers = { Accept: 'application/vnd.github+json' }
  if (pat) headers.Authorization = `Bearer ${pat}`
  return fetch(`https://api.github.com${path}`, { headers })
}

// Check that the PAT can reach the configured repo. Returns
// `{ ok: true }` on success, `{ ok: false, reason }` otherwise.
export async function checkRepoAccess(repoUrl, pat) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) return { ok: false, reason: 'Could not parse repo URL' }

  let res
  try {
    res = await ghFetch(`/repos/${parsed.owner}/${parsed.repo}`, pat)
  } catch {
    return { ok: false, reason: 'Network error — check your connection' }
  }

  if (res.ok) return { ok: true }
  if (res.status === 401) return { ok: false, reason: 'PAT was rejected by GitHub' }
  if (res.status === 404) return { ok: false, reason: pat ? 'Repo not found, or PAT lacks access to it' : 'Repo not found or not accessible' }
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

// Pre-fetch all blob contents in parallel. Returns a Map<path, string>.
// Skips files larger than 200 KB; failed fetches are silently omitted.
export async function getAllFileContents(repoUrl, pat, items) {
  const parsed = parseRepoUrl(repoUrl)
  if (!parsed) throw new Error('Could not parse repo URL')
  const { owner, repo } = parsed

  const blobs = items.filter(item => item.type === 'blob' && (item.size ?? 0) <= 200_000)
  const results = await Promise.allSettled(
    blobs.map(item =>
      ghFetch(`/repos/${owner}/${repo}/git/blobs/${item.sha}`, pat)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then(({ content }) => {
          const bytes = Uint8Array.from(atob(content.replace(/\n/g, '')), c => c.charCodeAt(0))
          return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        })
    )
  )
  const map = new Map()
  blobs.forEach((item, i) => {
    if (results[i].status === 'fulfilled') map.set(item.path, results[i].value)
  })
  return map
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