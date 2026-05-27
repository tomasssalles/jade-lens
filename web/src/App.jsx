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

  let content
  if (page === 'loading') {
    // Render Main's shell (without the gear) so the title's vertical
    // position matches the post-load layout — no flicker on refresh.
    content = <Main />
  } else if (page === 'setup') {
    content = (
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
    )
  } else if (page === 'settings') {
    content = <Settings onClose={() => history.back()} showToast={showToast} />
  } else {
    content = <Main onSettings={() => goTo('settings')} />
  }

  return (
    <>
      {content}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  )
}

export default App