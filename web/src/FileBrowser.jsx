import { useEffect, useRef, useState } from 'react'
import { getConfig } from './config'
import { getDB } from './db'
import { getRepoTree, fetchBlobs, getFileContent } from './github'
import FileTree from './FileTree'
import './FileBrowser.css'

function isExcluded(item) {
  const topLevel = item.path.split('/')[0]
  if (topLevel.startsWith('.')) return true
  if (item.path === 'CLAUDE.md') return true
  return false
}

// ─── Repo IndexedDB cache ──────────────────────────────────────────────────
// Stored value: { repoUrl, branch, items (all raw), contentMap (Map), truncated }
// `items` includes all tree items (unfiltered) so SHA comparison works on next load.

async function getCachedRepo() {
  const db = await getDB()
  return (await db.get('repo', 'data')) ?? null
}

function setCachedRepo(data) {
  return getDB().then(db => db.put('repo', data, 'data')).catch(() => {})
}

// ─── Session-level cache ───────────────────────────────────────────────────
// Survives in-app navigation (e.g. settings → back). Lost on page refresh.
// Stores filtered items only (display concern).

let _cache = null // { repoUrl, items, contentMap, truncated }

export function getContentFromCache(path) {
  return _cache?.contentMap?.get(path)
}

function parseJadeConfig(map) {
  const raw = map.get('.jade/config.json')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export default function FileBrowser({ onFileOpen, onJadeConfig }) {
  const [status, setStatus] = useState(() => _cache ? 'ready' : 'loading')
  const [error, setError] = useState(null)
  const [treeItems, setTreeItems] = useState(() => _cache?.items ?? [])
  const [truncated, setTruncated] = useState(() => _cache?.truncated ?? false)
  const [openDirs, setOpenDirs] = useState(() => {
    try {
      const saved = sessionStorage.getItem('openDirs')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const contentMapRef = useRef(_cache?.contentMap ?? new Map())

  useEffect(() => {
    let cancelled = false

    // Apply a loaded dataset to React state and session cache.
    function applyData(rawItems, contentMap, truncated, repoUrl) {
      const filtered = rawItems.filter(item => !isExcluded(item))
      _cache = { repoUrl, items: filtered, contentMap, truncated }
      contentMapRef.current = contentMap
      setTreeItems(filtered)
      setTruncated(truncated)
      setStatus('ready')
      const jadeCfg = parseJadeConfig(contentMap)
      if (jadeCfg) onJadeConfig?.(jadeCfg)
    }

    // Background refresh after restoring from IDB.
    // Fetches the tree, compares SHAs, fetches only changed blobs.
    // Silent on failure — cached data remains visible.
    async function refreshInBackground(cfg, cached) {
      try {
        const { items: newItems, branch, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        if (cancelled) return

        // SHA comparison: find new or changed blobs
        const oldShaMap = new Map(cached.items.map(i => [i.path, i.sha]))
        const newPathSet = new Set(newItems.map(i => i.path))
        const changedItems = newItems.filter(i =>
          i.type === 'blob' &&
          (i.size ?? 0) <= 200_000 &&
          oldShaMap.get(i.path) !== i.sha
        )
        const hasDeleted = cached.items.some(i => !newPathSet.has(i.path))

        if (changedItems.length === 0 && !hasDeleted) return  // no changes

        // Fetch only changed/new blobs
        const freshContent = changedItems.length > 0
          ? await fetchBlobs(cfg.githubRepoUrl, cfg.githubPat, changedItems)
          : new Map()
        if (cancelled) return

        // Build updated map: keep unchanged, drop deleted, overlay changed
        const map = new Map()
        for (const [path, content] of cached.contentMap) {
          if (newPathSet.has(path)) map.set(path, content)
        }
        for (const [path, content] of freshContent) {
          map.set(path, content)
        }

        setCachedRepo({ repoUrl: cfg.githubRepoUrl, branch, items: newItems, contentMap: map, truncated })
        if (!cancelled) applyData(newItems, map, truncated, cfg.githubRepoUrl)
      } catch { /* silent — user continues seeing cached data */ }
    }

    async function load() {
      try {
        const cfg = await getConfig()

        // 1. Session cache hit: in-app navigation (settings → back etc.), no refresh needed.
        if (_cache?.repoUrl === cfg.githubRepoUrl) {
          if (!cancelled) {
            contentMapRef.current = _cache.contentMap
            setTreeItems(_cache.items)
            setTruncated(_cache.truncated)
            setStatus('ready')
            const jadeCfg = parseJadeConfig(_cache.contentMap)
            if (jadeCfg) onJadeConfig?.(jadeCfg)
          }
          return
        }

        // 2. IDB cache hit: restore immediately, then silently check for updates.
        const cached = await getCachedRepo()
        if (cached?.repoUrl === cfg.githubRepoUrl) {
          if (!cancelled) applyData(cached.items, cached.contentMap, cached.truncated, cfg.githubRepoUrl)
          await refreshInBackground(cfg, cached)
          return
        }

        // 3. No cache: full fetch, then persist.
        const { items, branch, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        if (cancelled) return

        const map = await fetchBlobs(cfg.githubRepoUrl, cfg.githubPat, items)
        if (cancelled) return

        setCachedRepo({ repoUrl: cfg.githubRepoUrl, branch, items, contentMap: map, truncated })
        if (!cancelled) applyData(items, map, truncated, cfg.githubRepoUrl)

      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus('error') }
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  async function openFile(path) {
    let content = contentMapRef.current.get(path)
    if (content === undefined) {
      try {
        const cfg = await getConfig()
        content = await getFileContent(cfg.githubRepoUrl, cfg.githubPat, path)
      } catch (err) {
        setError(err.message)
        return
      }
    }
    onFileOpen(path, content)
  }

  function toggleDir(path) {
    setOpenDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      try { sessionStorage.setItem('openDirs', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  if (status === 'loading') return <p className="browser-message">Loading…</p>
  if (status === 'error') return <p className="browser-message browser-error">{error}</p>

  return (
    <div className="file-browser">
      {truncated && <p className="browser-message">Tree truncated — repo is too large for a single request.</p>}
      <FileTree
        items={treeItems}
        onFileClick={openFile}
        openDirs={openDirs}
        onToggle={toggleDir}
      />
    </div>
  )
}
