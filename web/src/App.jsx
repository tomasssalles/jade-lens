import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'
import FileView from './FileView'

function App() {
  const [page, setPage] = useState('loading')
  const [fileView, setFileView] = useState(null) // { path, content } | null
  const [toastMessage, setToastMessage] = useState(null)
  const toastTimer = useRef(null)

  function showToast(message, ms = 2000) {
    setToastMessage(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMessage(null), ms)
  }

  useEffect(() => {
    getConfig()
      .then(cfg => {
        if (!isConfigValid(cfg)) {
          history.replaceState({ page: 'setup' }, '', '#setup')
          setPage('setup')
          return
        }
        // Restore the page the user was on before a reload; default to 'main'.
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
    function onPopState(e) {
      const newPage = e.state?.page ?? 'main'
      setPage(newPage)
      if (newPage !== 'file') setFileView(null)
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

  return (
    <>
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
        />
      )}
      {page === 'settings' && (
        <Settings onClose={() => history.back()} showToast={showToast} />
      )}
      {page === 'file' && fileView && (
        <FileView path={fileView.path} content={fileView.content} onBack={() => history.back()} />
      )}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  )
}

export default App
