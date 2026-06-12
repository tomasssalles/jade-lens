import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfig } from './config'
import {
  preloadPromise, getCachedRepo, setCachedRepo,
  getPreloadedRepo, getSessionCache, setSessionCache,
  parseJadeConfig, parseDataVersion,
} from './repoCache'
import { getRepoTree, fetchBlobs, getFileContent } from './github'
import { getQueue, initQueueFromRead, getWorkingTree } from './sync/syncController'
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

function parseWikilink(s) {
  const m = s?.match(/^\[\[(.+)\]\]$/)
  return m ? m[1] : null
}

// Build the tree item list from Index.json. Returns an empty array if
// Index.json is absent or unparseable — no fallback to the raw git tree.
function indexItems(contentMap) {
  const content = contentMap?.get('Index.json')
  if (!content) return []
  try {
    const entries = JSON.parse(content)
    if (!Array.isArray(entries)) return []
    const result = []
    for (const entry of entries) {
      const path = parseWikilink(entry?.File)
      if (path) result.push({ path, type: 'blob', scope: entry.Scope ?? '' })
    }
    return result
  } catch {
    return []
  }
}

export default function FileBrowser({ onFileOpen, onJadeConfig, onDataVersion, onContentLoaded, syncTick = 0 }) {
  // Initialise synchronously from whatever is already in memory: the session
  // cache (in-app navigation) or the module-load IDB preload (page reload).
  const initData = getSessionCache() ?? getPreloadedRepo()

  const [status, setStatus] = useState(() => initData ? 'ready' : 'loading')
  const [treeItems, setTreeItems] = useState(
    () => indexItems(initData?.contentMap),
  )
  const [hasIndex, setHasIndex] = useState(() => initData?.contentMap?.has('Index.json') ?? false)
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
  // The latest cache/network "read view" — kept current so refreshFromQueue can
  // tell never-fetched files (structurally present, no content) apart from
  // deletions when merging the working map in.
  const cacheViewRef = useRef({
    items: filterItems(initData?.items),
    contentMap: initData?.contentMap ?? new Map(),
  })
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Re-source the tree from the queue's workingMap — the render authority once
  // the queue is initialised (§6.1, Phase 5d). Returns false (caller keeps the
  // cache-driven tree) when the queue isn't initialised for this repo, e.g. a
  // truncated tree that the init guard refused.
  const refreshFromQueue = useCallback(async () => {
    let cfg
    try { cfg = await getConfig() } catch { return false }
    const wt = await getWorkingTree({ repoUrl: cfg.githubRepoUrl }).catch(() => null)
    if (!wt || !mountedRef.current) return false
    contentMapRef.current = wt.contentMap
    setTreeItems(indexItems(wt.contentMap))
    setHasIndex(wt.contentMap.has('Index.json'))
    setTruncated(false)
    setStatus('ready')
    const jadeCfg = parseJadeConfig(wt.contentMap)
    if (jadeCfg) onJadeConfig?.(jadeCfg)
    onDataVersion?.(parseDataVersion(wt.contentMap))
    return true
  }, [onJadeConfig, onDataVersion])

  // Re-source the tree after a sync-on-focus (App bumps syncTick once sync has
  // updated the working map), so newly added/renamed/deleted files appear
  // without waiting for a remount + network refresh.
  useEffect(() => {
    if (syncTick > 0) refreshFromQueue()
  }, [syncTick, refreshFromQueue])

  useEffect(() => {
    let cancelled = false

    // Establish the sync queue's baseline from the content we're displaying
    // (§6.1 read-path → init). Best-effort: it fetches the head SHAs and is
    // guarded against truncated trees, but must never block or break the read.
    function ensureQueueInit(cfg, branch, contentMap, truncated) {
      return initQueueFromRead(getQueue(), {
        repoUrl: cfg.githubRepoUrl,
        branch,
        pat: cfg.githubPat,
        contentMap,
        truncated,
      })
        .then(async () => {
          if (cancelled) return
          onContentLoaded?.()
          await refreshFromQueue() // flip the tree onto the working map (§6.1)
        })
        .catch(() => {})
    }

    // Publish a fetched/cached repo record to component state, the session
    // cache, and the parent's jade config.
    function applyData(rawItems, contentMap, truncated, repoUrl) {
      const filtered = filterItems(rawItems)
      setSessionCache({ repoUrl, items: filtered, contentMap, truncated })
      contentMapRef.current = contentMap
      cacheViewRef.current = { items: filtered, contentMap }
      setTreeItems(indexItems(contentMap))
      setHasIndex(contentMap.has('Index.json'))
      setTruncated(truncated)
      setStatus('ready')
      const jadeCfg = parseJadeConfig(contentMap)
      if (jadeCfg) onJadeConfig?.(jadeCfg)
      onDataVersion?.(parseDataVersion(contentMap))
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
        cacheViewRef.current = { items: filtered, contentMap: map }

        // Only update visible tree state if the structure actually changed
        if (treeStructureChanged) {
          setTreeItems(indexItems(map))
          setHasIndex(map.has('Index.json'))
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
          cacheViewRef.current = { items: session.items, contentMap: session.contentMap }
          setTreeItems(indexItems(session.contentMap))
          setHasIndex(session.contentMap.has('Index.json'))
          setTruncated(session.truncated)
          setStatus('ready')
          const jadeCfg = parseJadeConfig(session.contentMap)
          if (jadeCfg) onJadeConfig?.(jadeCfg)
          onContentLoaded?.() // queue was initialised on a prior load this session
          refreshFromQueue() // prefer the working map over the (possibly stale) session items
          return
        }

        // 2. IDB cache (reusing the module-load preload read), then a
        //    background refresh against the network.
        const cached = await preloadPromise ?? await getCachedRepo()
        if (cached?.repoUrl === cfg.githubRepoUrl) {
          if (!cancelled) applyData(cached.items, cached.contentMap, cached.truncated, cfg.githubRepoUrl)
          await refreshInBackground(cfg, cached)
          if (!cancelled) {
            // Init from the freshest content the refresh left in the session cache.
            const fresh = getSessionCache()
            const current = fresh?.repoUrl === cfg.githubRepoUrl ? fresh : cached
            ensureQueueInit(cfg, cached.branch, current.contentMap, current.truncated)
          }
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
        ensureQueueInit(cfg, branch, map, truncated)
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
      {!hasIndex && (
        <p className="browser-message browser-error">
          Index.json is missing. Use the CLI or /jade skill to initialise it.
        </p>
      )}
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
