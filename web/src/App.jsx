import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'

// Hash-based navigation with a sentinel "floor" entry behind the initial
// page. First hardware back from main lands on the floor; we re-push the
// current page and show an "exit" toast. A second back within
// EXIT_WINDOW_MS skips the re-push and lets the WebView pop past the
// floor, which closes the standalone PWA activity on Android.
const EXIT_WINDOW_MS = 2000

function App() {
  const [page, setPage] = useState('loading')
  const [showExitToast, setShowExitToast] = useState(false)

  const pageRef = useRef('loading')
  useEffect(() => { pageRef.current = page }, [page])

  const lastBackOnFloor = useRef(0)
  const toastTimer = useRef(null)

  useEffect(() => {
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        history.replaceState({ floor: true }, '', '#')
        history.pushState({ page: initial }, '', '#' + initial)
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ floor: true }, '', '#')
        history.pushState({ page: 'setup' }, '', '#setup')
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
        setShowExitToast(true)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setShowExitToast(false), EXIT_WINDOW_MS)
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

  function goTo(newPage) {
    history.pushState({ page: newPage }, '', '#' + newPage)
    setPage(newPage)
  }

  if (page === 'loading') return <h1>Welcome to Jade Lens</h1>

  if (page === 'setup') return (
    <>
      <h1>Welcome to Jade Lens</h1>
      <div>
        <h2 className="form-title">Setup</h2>
        <SettingsForm onSuccess={() => {
          history.replaceState({ page: 'main' }, '', '#main')
          setPage('main')
        }} />
      </div>
    </>
  )

  if (page === 'settings') return <Settings onClose={() => history.back()} />

  return (
    <>
      <Main onSettings={() => goTo('settings')} />
      {showExitToast && <div className="exit-toast">Press back again to exit</div>}
    </>
  )
}

export default App