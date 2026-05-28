import { useEffect, useState } from 'react'
import { getConfig, isConfigValid } from './config'
import Settings from './Settings'
import './App.css'

function App() {
  const [page, setPage] = useState('loading')

  useEffect(() => {
    getConfig()
      .then(cfg => setPage(isConfigValid(cfg) ? 'main' : 'setup'))
      .catch(() => setPage('setup'))
  }, [])

  if (page === 'loading') return null

  if (page === 'setup' || page === 'settings') {
    return <Settings onSaved={() => setPage('main')} />
  }

  return (
    <div className="main">
      <button className="gear-button" onClick={() => setPage('settings')} aria-label="Settings">
        ⚙
      </button>
      <h1>Welcome to JADE LENS</h1>
    </div>
  )
}

export default App
