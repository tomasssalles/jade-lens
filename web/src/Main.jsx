import GearIcon from './assets/gear.svg?react'
import FileBrowser from './FileBrowser'

export default function Main({ onSettings, onFileOpen }) {
  return (
    <div className="main">
      {onSettings && (
        <button className="gear-button" onClick={onSettings} aria-label="Settings">
          <GearIcon />
        </button>
      )}
      {onSettings && <FileBrowser onFileOpen={onFileOpen} />}
    </div>
  )
}
