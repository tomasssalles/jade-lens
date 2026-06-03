import { useEffect, useMemo, useRef } from 'react'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import JsonCardViewer from './JsonCardViewer'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'
import { getCardColor, getTextColor } from './viewerSettings'
import './FileBrowser.css'

// Persist scroll positions across reloads via sessionStorage
const scrollPositions = (() => {
  const map = new Map()
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('jl-scroll:')) map.set(key.slice(10), +sessionStorage.getItem(key))
    }
  } catch {}
  return map
})()

export default function FileView({ path, content, onBack, viewerSettings, onWikilinkClick, onCheckboxToggle, onJsonValueEdit }) {
  const scrollerRef = useRef(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = scrollPositions.get(path) ?? 0
  }, [path])

  function handleScroll(e) {
    const y = e.currentTarget.scrollTop
    scrollPositions.set(path, y)
    try { sessionStorage.setItem('jl-scroll:' + path, y) } catch {}
  }

  const isJson = path.endsWith('.json')
  const isMarkdown = path.endsWith('.md')

  const parsed = useMemo(() => {
    if (!isJson) return null
    try {
      return { data: JSON.parse(content), error: null }
    } catch (e) {
      return { data: null, error: e.message }
    }
  }, [isJson, content])

  // JSON that parsed successfully → card viewer (manages its own layout +
  // breadcrumb). `parsed.error === null` distinguishes valid `null` content
  // (renders fine) from a parse failure (falls through to the text view).
  if (isJson && parsed && parsed.error === null) {
    return (
      <div className="file-view">
        <div className="file-view-json" ref={scrollerRef} onScroll={handleScroll}>
          <JsonCardViewer
            data={parsed.data}
            filePath={path}
            settings={viewerSettings}
            onWikilinkClick={onWikilinkClick}
            onValueEdit={onJsonValueEdit}
            onBack={onBack}
          />
        </div>
      </div>
    )
  }

  // Markdown → rendered view with breadcrumb on colored background
  if (isMarkdown) {
    const s = viewerSettings
    return (
      <div className="file-view">
        <div className="file-view-md" ref={scrollerRef} onScroll={handleScroll} style={{
          background: getCardColor(0, s),
          color: getTextColor(0, s),
        }}>
          <div style={{
            padding: `${s.cardPaddingY * 2}px ${s.cardPaddingX * 2}px`,
            boxSizing: 'border-box',
            minHeight: '100%',
          }}>
            <FileBreadcrumb filePath={path} s={s} onBack={onBack} />
            <div className="jl-file-content">
              <MarkdownRenderer
                content={content}
                onWikilinkClick={onWikilinkClick}
                onCheckboxToggle={onCheckboxToggle}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Fallback: plain text with header (JSON parse error or unknown file type)
  return (
    <div className="file-view">
      <div className="file-view-header">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <span className="file-view-path">{path}</span>
      </div>
      <pre className="file-view-content" ref={scrollerRef} onScroll={handleScroll}>
        {isJson && parsed?.error ? `JSON parse error: ${parsed.error}\n\n${content}` : content}
      </pre>
    </div>
  )
}
