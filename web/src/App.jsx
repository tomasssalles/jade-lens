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
  const pageRef = useRef('loading')
  const awaitingExitRef = useRef(false)
  const exitTimerRef = useRef(null)

  useEffect(() => {
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        history.replaceState({ page: '__floor__' }, '')
        history.pushState({ page: initial }, '')
        pageRef.current = initial
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: '__floor__' }, '')
        history.pushState({ page: 'setup' }, '')
        pageRef.current = 'setup'
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      if (!e.state?.page || e.state.page === '__floor__') {
        if (awaitingExitRef.current) {
          // Second back press — let the browser exit naturally
          return
        }
        // First back press on main — show toast, wait for second press
        awaitingExitRef.current = true
        setShowExitToast(true)
        exitTimerRef.current = setTimeout(() => {
          awaitingExitRef.current = false
          setShowExitToast(false)
          history.pushState({ page: pageRef.current }, '')
        }, 2000)
        return
      }
      pageRef.current = e.state.page
      setPage(e.state.page)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function goTo(newPage) {
    history.pushState({ page: newPage }, '')
    pageRef.current = newPage
    setPage(newPage)
  }

  const exitToast = showExitToast
    ? <div className="exit-toast">Press back again to exit</div>
    : null

  if (page === 'loading') return <h1>Welcome to Jade Lens</h1>

  if (page === 'setup') return (
    <>
      <h1>Welcome to Jade Lens</h1>
      <div>
        <h2 className="form-title">Setup</h2>
        <SettingsForm onSuccess={() => {
          history.replaceState({ page: 'main' }, '')
          pageRef.current = 'main'
          setPage('main')
        }} />
      </div>
    </>
  )

  if (page === 'settings') return <Settings onClose={() => history.back()} />

  return (
    <>
      <Main onSettings={() => goTo('settings')} />
      {exitToast}
    </>
  )
}

export default App
