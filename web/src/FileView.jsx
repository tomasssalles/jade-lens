import ArrowLeftIcon from './assets/arrow-left.svg?react'
import './FileBrowser.css'

export default function FileView({ path, content, onBack }) {
  return (
    <div className="file-view">
      <div className="file-view-header">
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <span className="file-view-path">{path}</span>
      </div>
      <pre className="file-view-content">{content}</pre>
    </div>
  )
}
