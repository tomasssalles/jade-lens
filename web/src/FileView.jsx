import { useMemo } from 'react'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import JsonCardViewer from './JsonCardViewer'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'
import { getCardColor, getTextColor } from './viewerSettings'
import './FileBrowser.css'

export default function FileView({ path, content, onBack, viewerSettings, onWikilinkClick }) {
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

  // JSON with valid data → card viewer (manages its own layout + breadcrumb)
  if (isJson && parsed?.data !== null) {
    return (
      <div className="file-view">
        <div className="file-view-json">
          <JsonCardViewer
            data={parsed.data}
            filePath={path}
            settings={viewerSettings}
            onWikilinkClick={onWikilinkClick}
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
        <div className="file-view-md" style={{
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
              <MarkdownRenderer content={content} onWikilinkClick={onWikilinkClick} />
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
      <pre className="file-view-content">
        {isJson && parsed?.error ? `JSON parse error: ${parsed.error}\n\n${content}` : content}
      </pre>
    </div>
  )
}
