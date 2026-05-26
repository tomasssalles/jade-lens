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
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        // Floor entry has no hash; page entries have distinct hash URLs
        // so Firefox Android can't skip them as same-URL duplicates
        history.replaceState({ page: '__floor__' }, '', location.pathname)
        history.pushState({ page: initial }, '', '#' + initial)
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: '__floor__' }, '', location.pathname)
        history.pushState({ page: 'setup' }, '', '#setup')
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      if (!e.state?.page || e.state.page === '__floor__') {
        if (awaitingExitRef.current) {
          // Second back press — let the browser exit
          return
        }
        awaitingExitRef.current = true
        setShowExitToast(true)
        exitTimerRef.current = setTimeout(() => {
          awaitingExitRef.current = false
          setShowExitToast(false)
          history.pushState({ page: 'main' }, '', '#main')
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
