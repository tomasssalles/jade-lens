import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import { getFileContent } from './github'
import { DEFAULT_VIEWER_SETTINGS, getViewerSettings, saveViewerSettings, applySettingsCssVars } from './viewerSettings'
import { TimeFormatContext } from './TimeFormatContext'
import { getContentFromCache, getPreloadedRepo, getCachedRepo, parseJadeConfig, updateCachedFile } from './repoCache'
import { buildCheckboxToggle } from './edit/checkbox'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'
import FileView from './FileView'
import StashView from './StashView'
import { getStashEntries, getQueue, commitEdit, getPendingCount } from './sync/syncController'

function jadeConfigFromRepo(repo) {
  if (!repo) return null
  return repo.jadeConfig ?? parseJadeConfig(repo.contentMap)
}

function App() {
  // 'init' = silent restore in progress (file view reload), renders nothing
  const [page, setPage] = useState(() => history.state?.page === 'file' ? 'init' : 'loading')
  const [fileView, setFileView] = useState(null) // { path, content } | null
  const [toastMessage, setToastMessage] = useState(null)
  const [viewerSettings, setViewerSettings] = useState(DEFAULT_VIEWER_SETTINGS)
  // Initialise synchronously from the module-load preload so the H1 is present
  // on the first render (no flash) when IDB resolved before mount.
  const [jadeConfig, setJadeConfig] = useState(() => jadeConfigFromRepo(getPreloadedRepo()))
  const [stashCount, setStashCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0) // unpushed local changes
  const toastTimer = useRef(null)
  const fileViewRef = useRef(null) // latest fileView, for the focus-sync closure
  const syncingRef = useRef(false) // guards against overlapping focus syncs
  const initialSyncDone = useRef(false) // one-shot retry-on-load guard

  // Recompute the top-bar indicators from the sync queue: the stash entry count
  // (conflicts) and the unpushed-batch count (changes that failed to sync).
  const refreshStatus = useCallback(async () => {
    try { setStashCount((await getStashEntries()).length) } catch { /* ignore */ }
    try { setPendingCount(await getPendingCount()) } catch { /* ignore */ }
  }, [])

  const showToast = useCallback((message, ms = 2000) => {
    setToastMessage(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMessage(null), ms)
  }, [])

  useEffect(() => {
    // Load viewer settings independently — failure just keeps the defaults
    getViewerSettings().then(vs => setViewerSettings(vs)).catch(() => {})

    getConfig()
      .then(async cfg => {
        if (!isConfigValid(cfg)) {
          history.replaceState({ page: 'setup' }, '', '#setup')
          setPage('setup')
          return
        }

        // Read repo cache once — used for both jade config preload and file restore
        let cached = null
        try { cached = await getCachedRepo() } catch {}
        const cacheValid = cached?.repoUrl === cfg.githubRepoUrl

        if (cacheValid) {
          const jadeCfg = jadeConfigFromRepo(cached)
          if (jadeCfg) setJadeConfig(jadeCfg)
        }

        const prior = history.state?.page
        if (prior === 'file') {
          const filePath = history.state?.filePath
          if (filePath && cacheValid) {
            const content = cached.contentMap?.get(filePath)
            if (content !== undefined) {
              setFileView({ path: filePath, content })
              setPage('file')
              return
            }
          }
          // File not in cache — fall back to main
          history.replaceState({ page: 'main' }, '', '#main')
          setPage('main')
          return
        }
        const initial = (prior === 'settings' || prior === 'main') ? prior : 'main'
        history.replaceState({ page: initial }, '', '#' + initial)
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: 'setup' }, '', '#setup')
        setPage('setup')
      })
  }, [])

  const openFile = useCallback((path, content) => {
    history.pushState({ page: 'file', filePath: path }, '', '#main-file')
    setFileView({ path, content })
    setPage('file')
  }, [])

  const handleWikilinkClick = useCallback(async (path) => {
    let content = getContentFromCache(path)
    if (content === undefined) {
      try {
        const cfg = await getConfig()
        content = await getFileContent(cfg.githubRepoUrl, cfg.githubPat, path)
      } catch {
        showToast(`Could not load ${path}`)
        return
      }
    }
    openFile(path, content)
  }, [openFile, showToast])

  // Micro-edit: toggle a task-list checkbox in the open markdown file. Derives a
  // unified_diff, commits it through the shared pipeline (commitEdit), then
  // re-renders from the queue's working content and refreshes the read caches.
  const handleCheckboxToggle = useCallback(async (line) => {
    if (!fileView) return
    const { path, content } = fileView
    const batch = buildCheckboxToggle(content, line, path)
    if (!batch) return

    let cfg
    try { cfg = await getConfig() } catch { return }
    const cached = await getCachedRepo().catch(() => null)

    try {
      const res = await commitEdit({
        repoUrl: cfg.githubRepoUrl,
        branch: cached?.branch,
        pat: cfg.githubPat,
        operations: batch.operations,
        commitMessage: batch.commitMessage,
        contentMap: cached?.repoUrl === cfg.githubRepoUrl ? cached.contentMap : undefined,
      })
      const newContent = res.workingMap?.get(path)
      if (newContent !== undefined) {
        setFileView({ path, content: newContent })
        await updateCachedFile(cfg.githubRepoUrl, path, newContent)
      }
      await refreshStatus()
      if (res.outcome === 'stashed') {
        showToast('Change conflicted with a remote edit — stashed for review.', 5000)
      } else if (res.error) {
        showToast(res.error, 6000)
      }
    } catch (err) {
      showToast(`Couldn't apply edit: ${err.message}`)
    }
  }, [fileView, refreshStatus, showToast])

  useEffect(() => {
    async function onPopState(e) {
      const newPage = e.state?.page ?? 'main'
      if (newPage === 'file') {
        const path = e.state?.filePath
        if (!path) { setPage('main'); setFileView(null); return }
        let content = getContentFromCache(path)
        if (content === undefined) {
          try {
            const cfg = await getConfig()
            content = await getFileContent(cfg.githubRepoUrl, cfg.githubPat, path)
          } catch {
            setPage('main'); setFileView(null); return
          }
        }
        setPage('file')
        setFileView({ path, content })
      } else {
        setPage(newPage)
        setFileView(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    const timer = toastTimer
    return () => {
      window.removeEventListener('popstate', onPopState)
      clearTimeout(timer.current)
    }
  }, [])

  const goTo = useCallback((newPage) => {
    history.pushState({ page: newPage }, '', '#' + newPage)
    setPage(newPage)
  }, [])

  useEffect(() => { fileViewRef.current = fileView }, [fileView])

  // Sync-on-focus (docs/sync-and-conflicts.md §2): pull remote on foreground,
  // routing any same-file conflicts into the stash, and push pending local work.
  // Best-effort and silent on offline/transient/auth failures — the explicit
  // edit path surfaces those; a background pull should not nag.
  const syncOnFocus = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      const q = getQueue()
      const state = await q.getState()
      if (!state) return // queue not initialised yet — nothing to sync
      let cfg
      try { cfg = await getConfig() } catch { return }
      if (state.repoUrl !== cfg.githubRepoUrl) return
      try { await q.sync({ pat: cfg.githubPat }) } catch { return }
      await refreshStatus()
      const after = await q.getState()
      const fv = fileViewRef.current
      const nc = after?.workingMap?.get(fv?.path)
      if (fv && nc !== undefined && nc !== fv.content) {
        setFileView({ path: fv.path, content: nc })
        updateCachedFile(cfg.githubRepoUrl, fv.path, nc)
      }
    } finally {
      syncingRef.current = false
    }
  }, [refreshStatus])

  // Fired by FileBrowser once content has loaded (and the queue is initialised).
  // Refreshes the indicators and, once per app load, retries any pending pushes —
  // so a reload / pull-to-refresh re-attempts a previously failed sync.
  const handleContentLoaded = useCallback(() => {
    refreshStatus()
    if (!initialSyncDone.current) {
      initialSyncDone.current = true
      syncOnFocus()
    }
  }, [refreshStatus, syncOnFocus])

  // Clicking the pending-sync indicator explains the state (no separate sheet).
  const handlePendingClick = useCallback(() => {
    showToast(
      'Some local changes haven’t synced yet. Reload the app to retry — ' +
      'and check that your token in Settings has write access.',
      7000,
    )
  }, [showToast])

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) syncOnFocus() }
    window.addEventListener('focus', syncOnFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', syncOnFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [syncOnFocus])

  useEffect(() => {
    applySettingsCssVars(viewerSettings)
  }, [viewerSettings])

  const updateViewerSettings = useCallback(async (newSettings) => {
    setViewerSettings(newSettings)
    try { await saveViewerSettings(newSettings) } catch {}
  }, [])

  const handleSettings = useCallback(() => goTo('settings'), [goTo])
  const handleStash = useCallback(() => goTo('stash'), [goTo])

  return (
    <TimeFormatContext.Provider value={viewerSettings.timeFormat ?? 'auto'}>
      {page === 'setup' && (
        <>
          <h1>Welcome to Jade Lens</h1>
          <div className="build-sha">{__BUILD_SHA__}</div>
          <div>
            <h2 className="form-title">Setup</h2>
            <SettingsForm
              showToast={showToast}
              onSuccess={() => {
                history.replaceState({ page: 'main' }, '', '#main')
                setPage('main')
              }}
            />
          </div>
        </>
      )}
      {/* Render Main for both loading (no gear/browser, anti-flicker) and main.
          Keeping it at the same JSX position lets React update props without remounting. */}
      {(page === 'loading' || page === 'main') && (
        <Main
          onSettings={page === 'main' ? handleSettings : undefined}
          onFileOpen={page === 'main' ? openFile : undefined}
          jadeConfig={jadeConfig}
          onJadeConfig={setJadeConfig}
          onContentLoaded={handleContentLoaded}
          stashCount={stashCount}
          onStash={page === 'main' ? handleStash : undefined}
          pendingCount={pendingCount}
          onPending={page === 'main' ? handlePendingClick : undefined}
        />
      )}
      {page === 'settings' && (
        <Settings
          onClose={() => history.back()}
          showToast={showToast}
          jadeConfig={jadeConfig}
          viewerSettings={viewerSettings}
          onViewerSettingsChange={updateViewerSettings}
        />
      )}
      {page === 'stash' && (
        <StashView
          onClose={() => history.back()}
          onChange={setStashCount}
          showToast={showToast}
        />
      )}
      {page === 'file' && fileView && (
        <FileView
          path={fileView.path}
          content={fileView.content}
          onBack={() => history.back()}
          viewerSettings={viewerSettings}
          onWikilinkClick={handleWikilinkClick}
          onCheckboxToggle={handleCheckboxToggle}
        />
      )}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </TimeFormatContext.Provider>
  )
}

export default App
