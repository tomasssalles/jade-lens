import { useEffect, useState } from 'react'
import { getConfig, saveConfig } from './config'

export default function Settings() {
  const [githubRepoUrl, setGithubRepoUrl] = useState('')
  const [githubPat, setGithubPat] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getConfig().then(cfg => {
      setGithubRepoUrl(cfg.githubRepoUrl ?? '')
      setGithubPat(cfg.githubPat ?? '')
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    await saveConfig({ githubRepoUrl, githubPat })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Settings</h2>
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
