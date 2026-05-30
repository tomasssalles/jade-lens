import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import { getFileContent } from './github'
import { DEFAULT_VIEWER_SETTINGS, getViewerSettings, saveViewerSettings, applySettingsCssVars } from './viewerSettings'
import { TimeFormatContext } from './TimeFormatContext'
import { getContentFromCache } from './FileBrowser'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'
import FileView from './FileView'

function App() {
  const [page, setPage] = useState('loading')
  const [fileView, setFileView] = useState(null) // { path, content } | null
  const [toastMessage, setToastMessage] = useState(null)
  const [viewerSettings, setViewerSettings] = useState(DEFAULT_VIEWER_SETTINGS)
  const [jadeConfig, setJadeConfig] = useState(null)
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
      .then(cfg => {
        if (!isConfigValid(cfg)) {
          history.replaceState({ page: 'setup' }, '', '#setup')
          setPage('setup')
          return
        }
        const prior = history.state?.page
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
