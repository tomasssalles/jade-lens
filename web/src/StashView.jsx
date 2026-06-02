import { useCallback, useEffect, useState } from 'react'
import ArrowLeftIcon from './assets/arrow-left.svg?react'
import { getConfig } from './config'
import { getStashEntries, resolveStashEntry } from './sync/syncController'
import { describeOperation } from './sync/stash'
import './Settings.css'
import './StashView.css'

function formatTimestamp(ts) {
  if (!ts) return 'Unknown time'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
}

// The stashed-changes view (docs/sync-and-conflicts.md §4 "Resolution"). Lists
// each stash entry — timestamp + per-op descriptions — with Done / Won't-do
// buttons. Both actions delete the entry (a normal synced commit); they differ
// only in the user's intent.
export default function StashView({ onClose, onChange, showToast }) {
  const [entries, setEntries] = useState(null) // null = loading
  const [busy, setBusy] = useState(null) // path currently being resolved

  const refresh = useCallback(async () => {
    try {
      const list = await getStashEntries()
      setEntries(list)
      onChange?.(list.length)
    } catch {
      setEntries([])
    }
  }, [onChange])

  // Initial load — state is set in the async continuation, not synchronously.
  useEffect(() => {
    let active = true
    getStashEntries()
      .then((list) => { if (active) { setEntries(list); onChange?.(list.length) } })
      .catch(() => { if (active) setEntries([]) })
    return () => { active = false }
  }, [onChange])

  async function resolve(path) {
    setBusy(path)
    try {
      const cfg = await getConfig()
      await resolveStashEntry(path, { pat: cfg.githubPat })
      await refresh()
    } catch (err) {
      showToast?.(`Could not resolve: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="icon-button" onClick={onClose} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <h2>Stashed changes</h2>
      </div>

      {entries === null && <p className="browser-message">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="browser-message">No stashed changes.</p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="stash-list">
          {entries.map(({ path, entry }) => (
            <li key={path} className="stash-entry">
              <div className="stash-entry-time">{formatTimestamp(entry?.timestamp)}</div>
              <ul className="stash-ops">
                {(entry?.operations ?? []).map((op, i) => (
                  <li key={i}>{describeOperation(op)}</li>
                ))}
                {(!entry || !entry.operations?.length) && (
                  <li className="stash-op-unreadable">Unreadable stash entry</li>
                )}
              </ul>
              <div className="stash-actions">
                <button
                  type="button"
                  className="stash-btn"
                  disabled={busy === path}
                  onClick={() => resolve(path)}
                >
                  Done
                </button>
                <button
                  type="button"
                  className="stash-btn stash-btn-secondary"
                  disabled={busy === path}
                  onClick={() => resolve(path)}
                >
                  Won&apos;t do
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
