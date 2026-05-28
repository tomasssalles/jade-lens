import { useEffect, useRef, useState } from 'react'
import { getConfig } from './config'
import { getRepoTree, getAllFileContents, getFileContent } from './github'
import FileTree from './FileTree'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import './FileBrowser.css'

function isExcluded(item) {
  const topLevel = item.path.split('/')[0]
  if (topLevel.startsWith('.')) return true
  if (item.path === 'CLAUDE.md') return true
  return false
}

export default function FileBrowser() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [treeItems, setTreeItems] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null) // { path, content } | null
  const [openDirs, setOpenDirs] = useState(() => {
    try {
      const saved = sessionStorage.getItem('openDirs')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const contentMapRef = useRef(new Map())

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const cfg = await getConfig()
        const { items, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        const filtered = items.filter(item => !isExcluded(item))
        if (cancelled) return
        setTreeItems(filtered)
        setTruncated(truncated)
        setStatus('ready')

        // Background: pre-fetch all file contents (including hidden dot-paths)
        const map = await getAllFileContents(cfg.githubRepoUrl, cfg.githubPat, items)
        if (!cancelled) contentMapRef.current = map
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
          setStatus('error')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Integrate with browser history so Android back == in-app back
  useEffect(() => {
    function onPopState(e) {
      if (!e.state?.filePath) setSelectedFile(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  async function openFile(path) {
    let content = contentMapRef.current.get(path)
    if (content === undefined) {
      try {
        const cfg = await getConfig()
        content = await getFileContent(cfg.githubRepoUrl, cfg.githubPat, path)
      } catch (err) {
        setError(err.message)
        return
      }
    }
    history.pushState(
      { ...(history.state ?? {}), filePath: path },
      '',
      location.pathname + location.search + '#main-file',
    )
    setSelectedFile({ path, content })
  }

  function closeFile() {
    history.back()
  }

  function toggleDir(path) {
    setOpenDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      try { sessionStorage.setItem('openDirs', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  if (status === 'loading') return <p className="browser-message">Loading…</p>
  if (status === 'error') return <p className="browser-message browser-error">{error}</p>

  if (selectedFile) {
    return (
      <div className="file-view">
        <div className="file-view-header">
          <button className="icon-button" onClick={closeFile} aria-label="Back">
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
      <FileTree
        items={treeItems}
        onFileClick={openFile}
        openDirs={openDirs}
        onToggle={toggleDir}
      />
    </div>
  )
}
