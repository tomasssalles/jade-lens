import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'

function App() {
  const [page, setPage] = useState('loading')
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
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
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
      setPage(e.state?.page ?? 'main')
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
      {/* Keep Main mounted for loading/main/settings so FileBrowser state survives
          navigating to settings and back. Hidden via display:none during settings. */}
      {page !== 'setup' && (
        <div style={page === 'settings' ? { display: 'none' } : undefined}>
          <Main onSettings={page === 'main' ? () => goTo('settings') : undefined} />
        </div>
      )}
      {page === 'settings' && (
        <Settings onClose={() => history.back()} showToast={showToast} />
      )}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  )
}

export default App