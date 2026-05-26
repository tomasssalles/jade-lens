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
    getConfig()
      .then(cfg => {
        const initial = isConfigValid(cfg) ? 'main' : 'setup'
        history.replaceState({ page: initial }, '')
        setPage(initial)
      })
      .catch(() => {
        history.replaceState({ page: 'setup' }, '')
        setPage('setup')
      })
  }, [])

  useEffect(() => {
    function onPopState(e) {
      if (e.state?.page) setPage(e.state.page)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function goTo(newPage) {
    history.pushState({ page: newPage }, '')
    setPage(newPage)
  }

  if (page === 'loading') return <h1>Welcome to Jade Lens</h1>

  if (page === 'setup') return (
    <>
      <h1>Welcome to Jade Lens</h1>
      <div>
        <h2 className="form-title">Setup</h2>
        <SettingsForm onSuccess={() => {
          history.replaceState({ page: 'main' }, '')
          setPage('main')
        }} />
      </div>
    </>
  )

  if (page === 'settings') return <Settings onClose={() => history.back()} />

  return <Main onSettings={() => goTo('settings')} />
}

export default App
