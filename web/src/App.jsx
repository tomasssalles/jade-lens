import { useEffect, useState } from 'react'
import './App.css'
import './Settings.css'
import { getConfig, isConfigValid } from './config'
import SettingsForm from './SettingsForm'
import Settings from './Settings'
import Main from './Main'

function App() {
  const [page, setPage] = useState('loading')

  useEffect(() => {
    const base = location.pathname
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        // Two identical entries so back never exhausts history.
        // Same URL means no visual transition when the back press
        // consumes entry 2 and we immediately push entry 3.
        history.replaceState({ page: initial }, '', base + '#' + initial)
        history.pushState({ page: initial }, '', base + '#' + initial)
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: 'setup' }, '', base + '#setup')
        history.pushState({ page: 'setup' }, '', base + '#setup')
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      const target = e.state?.page ?? 'main'
      setPage(target)
      // Re-push so there's always an entry below the current one.
      // pushState prunes any forward history (e.g. a stale #settings entry)
      // so the stack stays clean.
      history.pushState({ page: target }, '', location.pathname + '#' + target)
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
          const base = location.pathname
          history.replaceState({ page: 'main' }, '', base + '#main')
          history.pushState({ page: 'main' }, '', base + '#main')
          setPage('main')
        }} />
      </div>
    </>
  )

  if (page === 'settings') return <Settings onClose={() => history.back()} />

  return <Main onSettings={() => goTo('settings')} />
}

export default App
