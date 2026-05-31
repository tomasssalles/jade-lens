import { useEffect, useRef, useState } from 'react'
import { getConfig } from './config'
import {
  preloadPromise, getCachedRepo, setCachedRepo,
  getPreloadedRepo, getSessionCache, setSessionCache,
  parseJadeConfig,
} from './repoCache'
import { getRepoTree, fetchBlobs, getFileContent } from './github'
import FileTree from './FileTree'
import './FileBrowser.css'

function isExcluded(item) {
  const topLevel = item.path.split('/')[0]
  if (topLevel.startsWith('.')) return true
  if (item.path === 'CLAUDE.md') return true
  return false
}

function filterItems(items) {
  return Array.isArray(items) ? items.filter(item => !isExcluded(item)) : []
}

export default function FileBrowser({ onFileOpen, onJadeConfig }) {
  // Initialise synchronously from whatever is already in memory: the session
  // cache (in-app navigation) or the module-load IDB preload (page reload).
  const initData = getSessionCache() ?? getPreloadedRepo()

  const [status, setStatus] = useState(() => initData ? 'ready' : 'loading')
  const [treeItems, setTreeItems] = useState(() => filterItems(initData?.items))
  const [truncated, setTruncated] = useState(() => initData?.truncated ?? false)
  const [error, setError] = useState(null)
  const [openDirs, setOpenDirs] = useState(() => {
    try {
      const saved = sessionStorage.getItem('openDirs')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const contentMapRef = useRef(initData?.contentMap ?? new Map())

  useEffect(() => {
    let cancelled = false

    // Publish a fetched/cached repo record to component state, the session
    // cache, and the parent's jade config.
    function applyData(rawItems, contentMap, truncated, repoUrl) {
      const filtered = filterItems(rawItems)
      setSessionCache({ repoUrl, items: filtered, contentMap, truncated })
      contentMapRef.current = contentMap
      setTreeItems(filtered)
      setTruncated(truncated)
      setStatus('ready')
      const jadeCfg = parseJadeConfig(contentMap)
      if (jadeCfg) onJadeConfig?.(jadeCfg)
    }

    async function refreshInBackground(cfg, cached) {
      try {
        const { items: newItems, branch, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        if (cancelled) return

        // SHA comparison: classify changes
        const oldShaMap = new Map(cached.items.map(i => [i.path, i.sha]))
        const newPathSet = new Set(newItems.map(i => i.path))
        const changedItems = newItems.filter(i =>
          i.type === 'blob' &&
          (i.size ?? 0) <= 200_000 &&
          oldShaMap.get(i.path) !== i.sha
        )
        const hasDeleted = cached.items.some(i => !newPathSet.has(i.path))
        const hasAdded = newItems.some(i => i.type === 'blob' && !oldShaMap.has(i.path))
        const treeStructureChanged = hasDeleted || hasAdded
        const contentChanged = changedItems.length > 0

        if (!treeStructureChanged && !contentChanged) return  // true no-op

        // Fetch only changed/new blobs
        const freshContent = contentChanged
          ? await fetchBlobs(cfg.githubRepoUrl, cfg.githubPat, changedItems)
          : new Map()
        if (cancelled) return

        // Rebuild content map: keep unchanged, drop deleted, overlay changed
        const map = new Map()
        for (const [path, content] of cached.contentMap) {
          if (newPathSet.has(path)) map.set(path, content)
        }
        for (const [path, content] of freshContent) {
          map.set(path, content)
        }

        // Persist to IDB
        setCachedRepo({
          repoUrl: cfg.githubRepoUrl, branch, items: newItems,
          contentMap: map, truncated, jadeConfig: parseJadeConfig(map),
        })

        if (cancelled) return
        const filtered = filterItems(newItems)
        setSessionCache({ repoUrl: cfg.githubRepoUrl, items: filtered, contentMap: map, truncated })
        contentMapRef.current = map

        // Only update visible tree state if the structure actually changed
        if (treeStructureChanged) {
          setTreeItems(filtered)
          setTruncated(truncated)
        }
        // Notify jade config only if content (hence config) could have changed
        if (contentChanged) {
          const jadeCfg = parseJadeConfig(map)
          if (jadeCfg) onJadeConfig?.(jadeCfg)
        }
      } catch { /* background failures are silent */ }
    }

    async function load() {
      try {
        const cfg = await getConfig()

        // 1. Session cache: in-app navigation, no network needed.
        const session = getSessionCache()
        if (session?.repoUrl === cfg.githubRepoUrl) {
          contentMapRef.current = session.contentMap
          setTreeItems(session.items)
          setTruncated(session.truncated)
          setStatus('ready')
          const jadeCfg = parseJadeConfig(session.contentMap)
          if (jadeCfg) onJadeConfig?.(jadeCfg)
          return
        }

        // 2. IDB cache (reusing the module-load preload read), then a
        //    background refresh against the network.
        const cached = await preloadPromise ?? await getCachedRepo()
        if (cached?.repoUrl === cfg.githubRepoUrl) {
          if (!cancelled) applyData(cached.items, cached.contentMap, cached.truncated, cfg.githubRepoUrl)
          await refreshInBackground(cfg, cached)
          return
        }

        // 3. No cache: full fetch.
        const { items, branch, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        if (cancelled) return
        const map = await fetchBlobs(cfg.githubRepoUrl, cfg.githubPat, items)
        if (cancelled) return
        setCachedRepo({
          repoUrl: cfg.githubRepoUrl, branch, items,
          contentMap: map, truncated, jadeConfig: parseJadeConfig(map),
        })
        applyData(items, map, truncated, cfg.githubRepoUrl)
      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus('error') }
      }
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
