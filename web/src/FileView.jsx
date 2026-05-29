import { useMemo } from 'react'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import JsonCardViewer from './JsonCardViewer'
import './FileBrowser.css'

export default function FileView({ path, content, onBack, viewerSettings, onWikilinkClick }) {
  const isJson = path.endsWith('.json')

  const parsed = useMemo(() => {
    if (!isJson) return null
    try {
      return { data: JSON.parse(content), error: null }
    } catch (e) {
      return { data: null, error: e.message }
    }
  }, [isJson, content])

  const showOldHeader = !isJson || parsed?.data === null

  return (
    <div className="file-view">
      {showOldHeader && (
        <div className="file-view-header">
          <button className="icon-button" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon />
          </button>
          <span className="file-view-path">{path}</span>
        </div>
      )}
      {isJson && parsed?.data !== null ? (
        <div className="file-view-json">
          <JsonCardViewer
            data={parsed.data}
            filePath={path}
            settings={viewerSettings}
            onWikilinkClick={onWikilinkClick}
            onBack={onBack}
          />
        </div>
      ) : (
        <pre className="file-view-content">
          {isJson && parsed?.error ? `JSON parse error: ${parsed.error}\n\n${content}` : content}
        </pre>
      )}
    </div>
  )
}
