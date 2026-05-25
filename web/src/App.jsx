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
      .then(cfg => setPage(isConfigValid(cfg) ? 'main' : 'setup'))
      .catch(() => setPage('setup'))
  }, [])

  if (page === 'loading') return null

  if (page === 'setup') return (
    <>
      <h1>Welcome to Jade Lens</h1>
      <div>
        <h2 className="form-title">Setup</h2>
        <SettingsForm onSuccess={() => setPage('main')} />
      </div>
    </>
  )

  if (page === 'settings') return <Settings onClose={() => setPage('main')} />

  return <Main onSettings={() => setPage('settings')} />
}

export default App
