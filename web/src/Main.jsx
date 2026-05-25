import GearIcon from './assets/gear.svg?react'

export default function Main({ onSettings }) {
  return (
    <div className="main">
      <button className="gear-button" onClick={onSettings} aria-label="Settings">
        <GearIcon />
      </button>
      <h1>Welcome to Jade Lens</h1>
    </div>
  )
}
