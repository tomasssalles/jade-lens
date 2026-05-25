import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import EyeIcon from './assets/eye.svg?react'
import EyeOffIcon from './assets/eye-off.svg?react'

export default function SettingsForm({ onSuccess }) {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [githubPat, setGithubPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getConfig().then(cfg => {
      setGithubRepoUrl(cfg.githubRepoUrl ?? '')
      setGithubPat(cfg.githubPat ?? '')
    }).catch(() => setSaveError('Failed to load config'))
  }, [])

  function validate() {
    const errs = {}
    if (!githubRepoUrl.startsWith('https://github.com/')) {
      errs.githubRepoUrl = 'Must start with https://github.com/'
    }
    if (!githubPat.trim()) {
      errs.githubPat = 'Required'
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
    try {
      await saveConfig({ githubRepoUrl, githubPat })
      setSaveError(null)
      setSaved(true)
      setTimeout(() => { setSaved(false); onSuccess?.() }, 1000)
    } catch {
      setSaveError('Failed to save config')
    }
  }

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
        GitHub PAT
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
      </label>
      <button type="submit">{saved ? 'Saved!' : 'Save'}</button>
    </form>
  )
}
