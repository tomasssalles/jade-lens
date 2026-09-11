import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'
import { checkRepoAccess } from './github'
import { configureGithubProxy } from './githubTransport'
import EyeIcon from './assets/eye.svg?react'
import EyeOffIcon from './assets/eye-off.svg?react'

export default function SettingsForm({ onSuccess, showToast, jadeConfig }) {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyToken, setProxyToken] = useState('')
  const [loaded, setLoaded] = useState({ githubRepoUrl: '', proxyUrl: '', proxyToken: '' })
  const [showToken, setShowToken] = useState(false)
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    getConfig().then(cfg => {
      const next = {
        githubRepoUrl: cfg.githubRepoUrl ?? '',
        proxyUrl: cfg.proxyUrl ?? '',
        proxyToken: cfg.proxyToken ?? '',
      }
      setGithubRepoUrl(next.githubRepoUrl)
      setProxyUrl(next.proxyUrl)
      setProxyToken(next.proxyToken)
      setLoaded(next)
    }).catch(() => setSaveError('Failed to load config'))
  }, [])

  function validate() {
    const errs = {}
    if (!githubRepoUrl.startsWith('https://github.com/')) {
      errs.githubRepoUrl = 'Must start with https://github.com/'
    }
    if (!proxyUrl.startsWith('https://')) {
      errs.proxyUrl = 'Must start with https://'
    }
    if (proxyToken === '') {
      errs.proxyToken = 'Required'
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
      // Point the transport at this proxy so checkRepoAccess goes through it.
      configureGithubProxy(proxyUrl)
      const result = await checkRepoAccess(githubRepoUrl, proxyToken)
      if (!result.ok) {
        setSaveError(result.reason)
        return
      }
      await saveConfig({ githubRepoUrl, proxyUrl, proxyToken })
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
    githubRepoUrl === loaded.githubRepoUrl &&
    proxyUrl === loaded.proxyUrl &&
    proxyToken === loaded.proxyToken

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
        Proxy URL
        <input
          type="url"
          value={proxyUrl}
          onChange={e => { setProxyUrl(e.target.value); setErrors(v => ({ ...v, proxyUrl: null })) }}
        />
        {errors.proxyUrl && <span className="field-error">{errors.proxyUrl}</span>}
      </label>
      <label>
        Proxy token
        <div className="pat-wrapper">
          <input
            type={showToken ? 'text' : 'password'}
            value={proxyToken}
            onChange={e => { setProxyToken(e.target.value); setErrors(v => ({ ...v, proxyToken: null })) }}
          />
          <button
            type="button"
            className="pat-toggle"
            onClick={() => setShowToken(v => !v)}
            aria-label={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {errors.proxyToken && <span className="field-error">{errors.proxyToken}</span>}
        <span className="field-warning">
          Stored as plain text in this browser. It authorizes your proxy — revoke and
          reissue it there if it leaks.
        </span>
      </label>
      {jadeConfig && (
        <>
          <div className="settings-section-header">Profile</div>
          <label>
            Assistant name
            <input type="text" value={jadeConfig.assistant?.name ?? ''} disabled />
          </label>
          <label>
            Your full name
            <input type="text" value={jadeConfig.user?.full_name ?? ''} disabled />
          </label>
          <label>
            Your short name
            <input type="text" value={jadeConfig.user?.short_name ?? ''} disabled />
          </label>
        </>
      )}
      <button type="submit" disabled={unchanged || checking}>
        {checking ? 'Checking…' : 'Save'}
      </button>
    </form>
  )
}
