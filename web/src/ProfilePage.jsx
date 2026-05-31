import ArrowLeftIcon from './assets/arrow-left.svg?react'
import './Settings.css'

export default function ProfilePage({ onClose, jadeConfig }) {
  const cfg = jadeConfig ?? {}

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="icon-button" onClick={onClose} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <h2>Profile</h2>
      </div>
      <p className="profile-note">
        Read from <code>.jade/config.json</code> in your data repository.
        Edit that file directly to make changes.
      </p>
      <form className="settings-form">
        <label>
          Assistant name
          <input type="text" value={cfg.assistant?.name ?? ''} disabled />
        </label>
        <label>
          Your full name
          <input type="text" value={cfg.user?.full_name ?? ''} disabled />
        </label>
        <label>
          Your short name
          <input type="text" value={cfg.user?.short_name ?? ''} disabled />
        </label>
      </form>
    </div>
  )
}
