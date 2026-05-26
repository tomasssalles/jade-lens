import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'

function App() {
  const [page, setPage] = useState('loading')
  const [showExitToast, setShowExitToast] = useState(false)
  const awaitingExitRef = useRef(false)
  const exitTimerRef = useRef(null)

  useEffect(() => {
    const base = location.pathname
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        // All entries use hashes so all back navigation is hash-to-hash
        // (same-document). Mixing no-hash and hash URLs in Firefox Android
        // standalone mode causes the back press to bypass popstate entirely.
        history.replaceState({ page: '__floor__' }, '', base + '#')
        history.pushState({ page: initial }, '', base + '#' + initial)
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: '__floor__' }, '', base + '#')
        history.pushState({ page: 'setup' }, '', base + '#setup')
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      if (!e.state?.page || e.state.page === '__floor__') {
        if (awaitingExitRef.current) {
          return
        }
        awaitingExitRef.current = true
        setShowExitToast(true)
        exitTimerRef.current = setTimeout(() => {
          awaitingExitRef.current = false
          setShowExitToast(false)
          history.pushState({ page: 'main' }, '', location.pathname + '#main')
          setPage('main')
        }, 2000)
        return
      }
      setPage(e.state.page)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function goTo(newPage) {
    history.pushState({ page: newPage }, '', location.pathname + '#' + newPage)
    setPage(newPage)
  }

  if (page === 'loading') return <h1>Welcome to Jade Lens</h1>

  if (page === 'setup') return (
    <>
      <h1>Welcome to Jade Lens</h1>
      <div>
        <h2 className="form-title">Setup</h2>
        <SettingsForm onSuccess={() => {
          history.replaceState({ page: 'main' }, '', location.pathname + '#main')
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
