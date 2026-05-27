import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'

// Hash-based navigation with a sentinel "floor" entry behind the initial
// page. Floor and current entry share the same URL so popstate fires on
// back without a URL transition — empty-hash floor URLs caused a blank
// page on Android standalone PWAs. First hardware back from main lands
// on the floor; we re-push the current page and show an "exit" toast. A
// second back within EXIT_WINDOW_MS skips the re-push and lets the
// WebView pop past the floor, which closes the standalone PWA activity
// on Android.
const EXIT_WINDOW_MS = 2000

function App() {
  const [page, setPage] = useState('loading')
  const [toastMessage, setToastMessage] = useState(null)

  const pageRef = useRef('loading')
  useEffect(() => { pageRef.current = page }, [page])

  const lastBackOnFloor = useRef(0)
  const toastTimer = useRef(null)

  function showToast(message, ms = EXIT_WINDOW_MS) {
    setToastMessage(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMessage(null), ms)
  }

  useEffect(() => {
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        installFloor(initial)
        setPage(initial)
      })
      .catch(() => {
        installFloor('setup')
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      if (e.state?.floor) {
        const now = Date.now()
        if (now - lastBackOnFloor.current < EXIT_WINDOW_MS) {
          history.back()
          return
        }
        lastBackOnFloor.current = now
        history.pushState({ page: pageRef.current }, '', '#' + pageRef.current)
        showToast('Press back again to exit')
        return
      }
      setPage(e.state?.page ?? 'main')
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      clearTimeout(toastTimer.current)
    }
  }, [])

  function installFloor(target) {
    // Replace whatever entry we're on with the floor (same URL as the
    // target page) and push the target on top. Two history entries, one
    // URL — back fires popstate with state.floor and zero URL change.
    history.replaceState({ floor: true }, '', '#' + target)
    history.pushState({ page: target }, '', '#' + target)
  }

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
              installFloor('main')
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