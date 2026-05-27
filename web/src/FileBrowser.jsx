import { useEffect, useState } from 'react'
import { getConfig } from './config'
import { getRepoTree, getFileContent } from './github'
import FileTree from './FileTree'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import './FileBrowser.css'

export default function FileBrowser() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [treeItems, setTreeItems] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null) // { path, content } | null
  const [loadingFile, setLoadingFile] = useState(false)

  useEffect(() => {
    getConfig()
      .then(cfg => getRepoTree(cfg.githubRepoUrl, cfg.githubPat))
      .then(({ items, truncated }) => {
        setTreeItems(items)
        setTruncated(truncated)
        setStatus('ready')
      })
      .catch(err => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  async function openFile(path) {
    setLoadingFile(true)
    try {
      const cfg = await getConfig()
      const content = await getFileContent(cfg.githubRepoUrl, cfg.githubPat, path)
      setSelectedFile({ path, content })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingFile(false)
    }
  }

  if (status === 'loading') return <p className="browser-message">Loading…</p>
  if (status === 'error') return <p className="browser-message browser-error">{error}</p>

  if (selectedFile) {
    return (
      <div className="file-view">
        <div className="file-view-header">
          <button className="icon-button" onClick={() => setSelectedFile(null)} aria-label="Back">
            <ArrowLeftIcon />
          </button>
          <span className="file-view-path">{selectedFile.path}</span>
        </div>
        <pre className="file-view-content">{selectedFile.content}</pre>
      </div>
    )
  }

  return (
    <div className="file-browser">
      {truncated && <p className="browser-message">Tree truncated — repo is too large for a single request.</p>}
      {loadingFile && <p className="browser-message">Loading file…</p>}
      <FileTree items={treeItems} onFileClick={openFile} />
    </div>
  )
}
