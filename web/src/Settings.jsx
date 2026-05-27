import './Settings.css'
import SettingsForm from './SettingsForm'
import ArrowLeftIcon from './assets/arrow-left.svg?react'

export default function Settings({ onClose, showToast }) {
  return (
    <div>
      <div className="page-header">
        <button className="icon-button" onClick={onClose} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <h2>Settings</h2>
      </div>
      <SettingsForm onSuccess={onClose} showToast={showToast} />
    </div>
  )
}