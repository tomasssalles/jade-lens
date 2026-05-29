import { useEffect, useRef, useState } from 'react'
import { getConfig } from './config'
import { getRepoTree, getAllFileContents, getFileContent } from './github'
import FileTree from './FileTree'
import './FileBrowser.css'

function isExcluded(item) {
  const topLevel = item.path.split('/')[0]
  if (topLevel.startsWith('.')) return true
  if (item.path === 'CLAUDE.md') return true
  return false
}

// Lives outside the component so it survives unmount/remount (e.g. navigating
// to settings and back). Invalidated automatically when repoUrl changes.
let _cache = null // { repoUrl, items, contentMap, truncated } | null

export function getContentFromCache(path) {
  return _cache?.contentMap?.get(path)
}

export default function FileBrowser({ onFileOpen }) {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [treeItems, setTreeItems] = useState([])
  const [truncated, setTruncated] = useState(false)
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
        if (_cache?.repoUrl === cfg.githubRepoUrl) {
          if (!cancelled) {
            setTreeItems(_cache.items)
            setTruncated(_cache.truncated)
            contentMapRef.current = _cache.contentMap
            setStatus('ready')
          }
          return
        }

        const { items, truncated } = await getRepoTree(cfg.githubRepoUrl, cfg.githubPat)
        const filtered = items.filter(item => !isExcluded(item))
        if (cancelled) return
        setTreeItems(filtered)
        setTruncated(truncated)
        setStatus('ready')

        // Background: pre-fetch all file contents (including hidden dot-paths)
        const map = await getAllFileContents(cfg.githubRepoUrl, cfg.githubPat, items)
        if (!cancelled) {
          contentMapRef.current = map
          _cache = { repoUrl: cfg.githubRepoUrl, items: filtered, contentMap: map, truncated }
        }
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
    onFileOpen(path, content)
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
