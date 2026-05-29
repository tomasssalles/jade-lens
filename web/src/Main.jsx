import GearIcon from './assets/gear.svg?react'
import FileBrowser from './FileBrowser'

export default function Main({ onSettings, onFileOpen, jadeConfig, onJadeConfig }) {
  const assistantName = jadeConfig?.assistant?.name
  return (
    <div className="main">
      {onSettings && (
        <button className="gear-button" onClick={onSettings} aria-label="Settings">
          <GearIcon />
        </button>
      )}
      {assistantName && <h1 className="assistant-name">{assistantName}</h1>}
      {onSettings && <FileBrowser onFileOpen={onFileOpen} onJadeConfig={onJadeConfig} />}
    </div>
  )
}
