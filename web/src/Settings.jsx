import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import './Settings.css'

export default function Settings({ onSaved }) {
  const [repoUrl, setRepoUrl] = useState('')
  const [pat, setPat] = useState('')
  const [patVisible, setPatVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getConfig().then(cfg => {
      setRepoUrl(cfg.githubRepoUrl ?? '')
      setPat(cfg.githubPat ?? '')
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await saveConfig({ githubRepoUrl: repoUrl.trim(), githubPat: pat.trim() })
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <h1 className="settings-title">Settings</h1>
      <label className="settings-label">
        GitHub repo URL
        <input
          className="settings-input"
          type="url"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          required
        />
      </label>
      <label className="settings-label">
        GitHub personal access token
        <div className="settings-pat-row">
          <input
            className="settings-input"
            type={patVisible ? 'text' : 'password'}
            value={pat}
            onChange={e => setPat(e.target.value)}
            placeholder="ghp_…"
            required
          />
          <button
            type="button"
            className="settings-toggle"
            onClick={() => setPatVisible(v => !v)}
            aria-label={patVisible ? 'Hide token' : 'Show token'}
          >
            {patVisible ? 'Hide' : 'Show'}
          </button>
        </div>
        <span className="settings-warning">Stored as plain text in this browser.</span>
      </label>
      {error && <p className="settings-error">{error}</p>}
      <button className="settings-save" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
