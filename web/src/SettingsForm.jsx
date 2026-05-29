import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import { checkRepoAccess } from './github'
import EyeIcon from './assets/eye.svg?react'
import EyeOffIcon from './assets/eye-off.svg?react'

export default function SettingsForm({ onSuccess, showToast }) {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [githubPat, setGithubPat] = useState('')
  const [loaded, setLoaded] = useState({ githubRepoUrl: '', githubPat: '' })
  const [showPat, setShowPat] = useState(false)
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    getConfig().then(cfg => {
      const next = {
        githubRepoUrl: cfg.githubRepoUrl ?? '',
        githubPat: cfg.githubPat ?? '',
      }
      setGithubRepoUrl(next.githubRepoUrl)
      setGithubPat(next.githubPat)
      setLoaded(next)
    }).catch(() => setSaveError('Failed to load config'))
  }, [])

  function validate() {
    const errs = {}
    if (!githubRepoUrl.startsWith('https://github.com/')) {
      errs.githubRepoUrl = 'Must start with https://github.com/'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setChecking(true)
    try {
      const result = await checkRepoAccess(githubRepoUrl, githubPat)
      if (!result.ok) {
        setSaveError(result.reason)
        return
      }
      await saveConfig({ githubRepoUrl, githubPat })
      setSaveError(null)
      showToast?.('Settings saved')
      onSuccess?.()
    } catch {
      setSaveError('Failed to save config')
    } finally {
      setChecking(false)
    }
  }

  const unchanged =
    githubRepoUrl === loaded.githubRepoUrl && githubPat === loaded.githubPat

  return (
    <form onSubmit={handleSubmit}>
      {saveError && <p className="form-error">{saveError}</p>}
      <label>
        GitHub repo URL
        <input
          type="url"
          value={githubRepoUrl}
          onChange={e => { setGithubRepoUrl(e.target.value); setErrors(v => ({ ...v, githubRepoUrl: null })) }}
        />
        {errors.githubRepoUrl && <span className="field-error">{errors.githubRepoUrl}</span>}
      </label>
      <label>
        GitHub PAT <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional for public repos)</span>
        <div className="pat-wrapper">
          <input
            type={showPat ? 'text' : 'password'}
            value={githubPat}
            onChange={e => { setGithubPat(e.target.value); setErrors(v => ({ ...v, githubPat: null })) }}
          />
          <button
            type="button"
            className="pat-toggle"
            onClick={() => setShowPat(v => !v)}
            aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
          >
            {showPat ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {errors.githubPat && <span className="field-error">{errors.githubPat}</span>}
        <span className="field-warning">
          Stored as plain text in this browser. Any web app served from the same domain can read it.
        </span>
      </label>
      <button type="submit" disabled={unchanged || checking}>
        {checking ? 'Checking…' : 'Save'}
      </button>
    </form>
  )
}