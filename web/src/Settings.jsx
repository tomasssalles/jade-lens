import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import './Settings.css'

export default function Settings() {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [githubPat, setGithubPat] = useState('')
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
        <input
          type="password"
          value={githubPat}
          onChange={e => setGithubPat(e.target.value)}
        />
      </label>
      <button type="submit">{saved ? 'Saved!' : 'Save'}</button>
    </form>
  )
}
