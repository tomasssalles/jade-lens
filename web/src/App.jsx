import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import { getFileContent } from './github'
import { DEFAULT_VIEWER_SETTINGS, getViewerSettings, saveViewerSettings, applySettingsCssVars } from './viewerSettings'
import { TimeFormatContext } from './TimeFormatContext'
import { getContentFromCache, getPreloadedRepo, getCachedRepo, parseJadeConfig, updateCachedFile, SUPPORTED_DATA_FORMAT_VERSION } from './repoCache'
import { buildCheckboxToggle } from './edit/checkbox'
import { buildJsonValueEdit } from './edit/jsonValueEdit'
import { applyUnifiedDiff } from './mutation/unifiedDiff'
import { applyJsonPatch } from './mutation/jsonPatch'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './MainView'
import FileView from './FileView'
import StashView from './StashView'
import { getStashEntries, getQueue, commitEdit, getPendingCount, syncPending, getWorkingContent } from './sync/syncController'

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
  const [dataVersion, setDataVersion] = useState(null)
  const [stashCount, setStashCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0) // unpushed local changes
  const [syncTick, setSyncTick] = useState(0) // bumped after a sync updates the working map, to refresh the tree
  const [repoFiles, setRepoFiles] = useState([]) // repo-relative paths for the wikilink value-editor picker
  const toastTimer = useRef(null)
  const fileViewRef = useRef(null) // latest fileView, for the focus-sync closure
  const syncingRef = useRef(false) // guards against overlapping focus syncs
  const initialSyncDone = useRef(false) // one-shot retry-on-load guard
  const editChainRef = useRef(Promise.resolve()) // serialises background edit commits

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
          if (filePath) {
            // Prefer the queue's working content (persisted, carries the latest
            // local edits) over the read cache, which may lag behind a reload.
            const wc = await getWorkingContent(filePath, { repoUrl: cfg.githubRepoUrl }).catch(() => undefined)
            const content = wc ?? (cacheValid ? cached.contentMap?.get(filePath) : undefined)
            if (content !== undefined) {
              setFileView({ path: filePath, content })
              setPage('file')
              return
            }
          }
          // No content available — fall back to main
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

  // The content to display for a path: the queue's working content if it has it
  // (the authority — local edits, synced or pending, surviving reloads), else
  // the supplied fallback (from a cache or the network).
  const resolveContent = useCallback(async (path, fallback) => {
    try {
      const cfg = await getConfig()
      const wc = await getWorkingContent(path, { repoUrl: cfg.githubRepoUrl })
      if (wc !== undefined) return wc
    } catch { /* fall through to the fallback */ }
    return fallback
  }, [])

  const openFile = useCallback(async (path, content) => {
    history.pushState({ page: 'file', filePath: path }, '', '#main-file')
    setFileView({ path, content: await resolveContent(path, content) })
    setPage('file')
  }, [resolveContent])

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

  // The background half of an in-place edit: persist + sync the already-applied
  // change through the shared pipeline. Serialised via editChainRef so rapid
  // edits don't race the queue. Does NOT touch the view on success — the
  // optimistic update already shows the right thing; it only reconciles when a
  // conflict was stashed (the local change was rolled back to the remote).
  const commitBatch = useCallback(async (path, batch) => {
    let cfg
    try { cfg = await getConfig() } catch { return }
    const cached = await getCachedRepo().catch(() => null)
    let res
    try {
      res = await commitEdit({
        repoUrl: cfg.githubRepoUrl,
        branch: cached?.branch,
        pat: cfg.githubPat,
        operations: batch.operations,
        commitMessage: batch.commitMessage,
        contentMap: cached?.repoUrl === cfg.githubRepoUrl ? cached.contentMap : undefined,
      })
    } catch (err) {
      showToast(`Couldn't apply edit: ${err.message}`)
      return
    }
    const wc = res.workingMap?.get(path)
    if (wc !== undefined) updateCachedFile(cfg.githubRepoUrl, path, wc) // best-effort cache freshen
    if (res.outcome === 'stashed') {
      if (wc !== undefined) {
        setFileView((prev) => (prev && prev.path === path ? { path, content: wc } : prev))
      }
      showToast('Change conflicted with a remote edit — stashed for review.', 5000)
    } else if (res.error) {
      showToast(res.error, 6000)
    }
    await refreshStatus()
  }, [refreshStatus, showToast])

  // Micro-edit: toggle a task-list checkbox in the open markdown file. Flips the
  // checkbox in the UI immediately (optimistic), then persists + syncs in the
  // background — the visual toggle never waits on the network.
  const handleCheckboxToggle = useCallback((line) => {
    const fv = fileViewRef.current
    if (!fv) return
    const { path, content } = fv
    const batch = buildCheckboxToggle(content, line, path)
    if (!batch) return
    let optimistic
    try { optimistic = applyUnifiedDiff(content, batch.operations[0].diff) } catch { return }
    setFileView({ path, content: optimistic })
    editChainRef.current = editChainRef.current.then(() => commitBatch(path, batch)).catch(() => {})
  }, [commitBatch])

  // Micro-edit: change a JSON value in place (booleans first — toggling
  // true/false). Applies the json_patch optimistically (canonical re-serialize,
  // matching the pipeline) then persists + syncs in the background, like the
  // checkbox. The no-op guard skips a change that leaves the content untouched.
  const handleJsonValueEdit = useCallback((pointer, newValue) => {
    const fv = fileViewRef.current
    if (!fv || !fv.path.endsWith('.json')) return
    let before
    try { before = JSON.parse(fv.content) } catch { return }
    const patch = [{ op: 'replace', path: pointer, value: newValue }]
    let after
    try { after = applyJsonPatch(before, patch) } catch { return }
    if (JSON.stringify(after) === JSON.stringify(before)) return // no-op guard
    const { path } = fv
    const optimistic = JSON.stringify(after, null, 2) + '\n'
    setFileView({ path, content: optimistic })
    const batch = buildJsonValueEdit(path, pointer, newValue)
    editChainRef.current = editChainRef.current.then(() => commitBatch(path, batch)).catch(() => {})
  }, [commitBatch])

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
        setFileView({ path, content: await resolveContent(path, content) })
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
  }, [resolveContent])

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
      setSyncTick(t => t + 1) // working map may have gained/lost files — refresh the tree
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

  // Retry pending (previously-failed) pushes once per app load. Driven from App
  // — NOT from FileBrowser — so it runs no matter which page the app reopened on
  // (FileBrowser only mounts on the main screen; you can reload straight into a
  // file view). Unlike the silent focus retry, a deliberate (re)load reports the
  // outcome, since reloading is the documented way to retry.
  const retryPendingOnLoad = useCallback(async () => {
    let cfg
    try { cfg = await getConfig() } catch { return }
    let result
    try {
      result = await syncPending({ repoUrl: cfg.githubRepoUrl, pat: cfg.githubPat })
    } catch { return }
    if (!result.hadPending) return // nothing was pending → stay silent

    await refreshStatus()
    setSyncTick(t => t + 1) // a stashed conflict can change the tracked file set
    // Re-render the open file if the retry changed its content (e.g. a conflict
    // was stashed and the remote version won).
    const fv = fileViewRef.current
    const nc = result.workingMap?.get(fv?.path)
    if (fv && nc !== undefined && nc !== fv.content) {
      setFileView({ path: fv.path, content: nc })
      updateCachedFile(cfg.githubRepoUrl, fv.path, nc)
    }

    if (result.outcome === 'synced') {
      showToast('Local changes synced.', 3000)
    } else if (result.outcome === 'stashed') {
      showToast('A change conflicted with a remote edit — stashed for review.', 6000)
    } else if (result.error) {
      // Same classified message the edit path shows (e.g. read-only / rejected token).
      showToast(result.error, 7000)
    } else {
      showToast('Couldn’t reach GitHub — your changes are still saved locally. Reload to retry.', 6000)
    }
  }, [refreshStatus, showToast])

  useEffect(() => {
    if (initialSyncDone.current) return
    initialSyncDone.current = true
    retryPendingOnLoad()
  }, [retryPendingOnLoad])

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

  // The repo files offered by the wikilink value-editor's picker. Sourced from
  // the read cache (best-effort) and refreshed whenever a sync changes the
  // tracked file set. Protected trees and non-editable files are excluded.
  useEffect(() => {
    let cancelled = false
    getCachedRepo()
      .then((cached) => {
        if (cancelled || !cached?.contentMap) return
        const files = [...cached.contentMap.keys()]
          .filter((p) => (p.endsWith('.md') || p.endsWith('.json'))
            && !p.startsWith('.jade/') && !p.startsWith('.claude/') && !p.startsWith('.git/'))
          .sort()
        setRepoFiles(files)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [syncTick])

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
      {dataVersion !== null && dataVersion < SUPPORTED_DATA_FORMAT_VERSION && (
        <div className="version-warning">
          ⚠️ Your data is at format version v{dataVersion}, but this app requires v{SUPPORTED_DATA_FORMAT_VERSION}.
          Run <code>/{jadeConfig?.assistant?.name ?? 'jade'}-migrate</code> in Claude Code to migrate your data.
          Editing is disabled until migration is complete.
        </div>
      )}
      {dataVersion !== null && dataVersion > SUPPORTED_DATA_FORMAT_VERSION && (
        <div className="version-warning">
          ⚠️ Your data is at format version v{dataVersion}, which is newer than this app supports (v{SUPPORTED_DATA_FORMAT_VERSION}).
          Please reload the page (or clear the cache and reload) to get the latest app version.
          Editing is disabled.
        </div>
      )}
      {(page === 'loading' || page === 'main') && (
        <Main
          onSettings={page === 'main' ? handleSettings : undefined}
          onFileOpen={page === 'main' ? openFile : undefined}
          jadeConfig={jadeConfig}
          onJadeConfig={setJadeConfig}
          onDataVersion={setDataVersion}
          onContentLoaded={refreshStatus}
          stashCount={stashCount}
          onStash={page === 'main' ? handleStash : undefined}
          pendingCount={pendingCount}
          onPending={page === 'main' ? handlePendingClick : undefined}
          syncTick={syncTick}
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
          onCheckboxToggle={dataVersion === SUPPORTED_DATA_FORMAT_VERSION ? handleCheckboxToggle : null}
          onJsonValueEdit={dataVersion === SUPPORTED_DATA_FORMAT_VERSION ? handleJsonValueEdit : null}
          repoFiles={repoFiles}
        />
      )}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </TimeFormatContext.Provider>
  )
}

export default App
