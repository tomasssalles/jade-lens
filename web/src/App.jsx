import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import { getFileContent } from './github'
import { DEFAULT_VIEWER_SETTINGS, getViewerSettings, saveViewerSettings, applySettingsCssVars } from './viewerSettings'
import { TimeFormatContext } from './TimeFormatContext'
import { getContentFromCache } from './FileBrowser'
import { getCachedRepo } from './repoCache'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'
import FileView from './FileView'

function parseJadeConfig(map) {
  if (!map) return null
  const raw = map.get('.jade/config.json')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// Module-level IDB preload so jadeConfig is available synchronously on first render
let _appPreload = null
getCachedRepo().then(d => { _appPreload = d }).catch(() => {})

function App() {
  // 'init' = silent restore in progress (file view reload), renders nothing
  const [page, setPage] = useState(() => history.state?.page === 'file' ? 'init' : 'loading')
  const [fileView, setFileView] = useState(null) // { path, content } | null
  const [toastMessage, setToastMessage] = useState(null)
  const [viewerSettings, setViewerSettings] = useState(DEFAULT_VIEWER_SETTINGS)
  // Initialise synchronously from preload so the H1 is present on the first render
  const [jadeConfig, setJadeConfig] = useState(() =>
    _appPreload ? (_appPreload.jadeConfig ?? parseJadeConfig(_appPreload.contentMap)) : null
  )
  const toastTimer = useRef(null)

  function showToast(message, ms = 2000) {
    setToastMessage(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMessage(null), ms)
  }

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

        // Set jade config (fallback: parse from contentMap for old IDB records lacking jadeConfig)
        if (cacheValid) {
          const jadeCfg = cached.jadeConfig ?? parseJadeConfig(cached.contentMap)
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
    return () => {
      window.removeEventListener('popstate', onPopState)
      clearTimeout(toastTimer.current)
    }
  }, [])

  function goTo(newPage) {
    history.pushState({ page: newPage }, '', '#' + newPage)
    setPage(newPage)
  }

  function openFile(path, content) {
    history.pushState({ page: 'file', filePath: path }, '', '#main-file')
    setFileView({ path, content })
    setPage('file')
  }

  async function handleWikilinkClick(path) {
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
  }

  useEffect(() => {
    applySettingsCssVars(viewerSettings)
  }, [viewerSettings])

  async function updateViewerSettings(newSettings) {
    setViewerSettings(newSettings)
    try { await saveViewerSettings(newSettings) } catch {}
  }

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
          onSettings={page === 'main' ? () => goTo('settings') : undefined}
          onFileOpen={page === 'main' ? openFile : undefined}
          jadeConfig={jadeConfig}
          onJadeConfig={setJadeConfig}
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
      {page === 'file' && fileView && (
        <FileView
          path={fileView.path}
          content={fileView.content}
          onBack={() => history.back()}
          viewerSettings={viewerSettings}
          onWikilinkClick={handleWikilinkClick}
        />
      )}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </TimeFormatContext.Provider>
  )
}

export default App
