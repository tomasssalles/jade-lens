import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import './Settings.css'

export default function Settings() {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [githubPat, setGithubPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getConfig().then(cfg => {
      setGithubRepoUrl(cfg.githubRepoUrl ?? '')
      setGithubPat(cfg.githubPat ?? '')
    }).catch(() => setError('Failed to load config'))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await saveConfig({ githubRepoUrl, githubPat })
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save config')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Settings</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <label>
        GitHub repo URL
        <input
          type="url"
          value={githubRepoUrl}
          onChange={e => setGithubRepoUrl(e.target.value)}
        />
      </label>
      <label>
        GitHub PAT
        <div className="pat-wrapper">
          <input
            type={showPat ? 'text' : 'password'}
            value={githubPat}
            onChange={e => setGithubPat(e.target.value)}
          />
          <button
            type="button"
            className="pat-toggle"
            onClick={() => setShowPat(v => !v)}
            aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
          >
            {showPat
              ? <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
      </label>
      <button type="submit">{saved ? 'Saved!' : 'Save'}</button>
    </form>
  )
}
