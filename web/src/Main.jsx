import GearIcon from './assets/gear.svg?react'
import FileBrowser from './FileBrowser'

export default function Main({
  onSettings,
  onFileOpen,
  jadeConfig,
  onJadeConfig,
  onContentLoaded,
  stashCount = 0,
  onStash,
  pendingCount = 0,
  onPending,
  syncTick = 0,
}) {
  const assistantName = jadeConfig?.assistant?.name
  return (
    <div className="main">
      {onSettings && pendingCount > 0 && onPending && (
        <button
          className="pending-indicator"
          onClick={onPending}
          aria-label={`${pendingCount} change${pendingCount === 1 ? '' : 's'} not synced`}
          title="Some local changes haven’t synced. Reload the app to retry."
        >
          📤<span className="pending-count">{pendingCount}</span>
        </button>
      )}
      {onSettings && stashCount > 0 && onStash && (
        <button
          className="stash-indicator"
          onClick={onStash}
          aria-label={`${stashCount} stashed change${stashCount === 1 ? '' : 's'}`}
          title={`${stashCount} stashed change${stashCount === 1 ? '' : 's'} — tap to review`}
        >
          ⚠️
        </button>
      )}
      {onSettings && (
        <button className="gear-button" onClick={onSettings} aria-label="Settings">
          <GearIcon />
        </button>
      )}
      {assistantName && <h1 className="assistant-name">{assistantName}</h1>}
      {onSettings && <div className="build-sha">{__BUILD_SHA__}</div>}
      {onSettings && (
        <FileBrowser
          onFileOpen={onFileOpen}
          onJadeConfig={onJadeConfig}
          onContentLoaded={onContentLoaded}
          syncTick={syncTick}
        />
      )}
    </div>
  )
}
