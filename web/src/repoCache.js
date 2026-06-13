import { getDB } from './db'

// ─── Shape ──────────────────────────────────────────────────────────────────
//
// A cached repo record is:
//   { repoUrl, branch, items, contentMap: Map<path,string>, truncated, jadeConfig }
//
// It lives in two places:
//   • IndexedDB  — survives page reloads (persisted via setCachedRepo).
//   • In-memory  — survives in-app navigation only (the "session cache").
//
// This module is the single source of truth for both, plus the one-time
// module-load preload that lets the first render show cached data without a
// "Loading…" flash.

// ─── jade config parsing ──────────────────────────────────────────────────────

// Extract and parse `.jade/config.json` from a content map. Returns the parsed
// object, or null if absent / unparseable.
export function parseJadeConfig(contentMap) {
  const raw = contentMap?.get('.jade/config.json')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// The data-format version this app supports. Bumped in Phase 10 alongside the
// CLI's __supported_data_format_version__.
export const SUPPORTED_DATA_FORMAT_VERSION = 2

// Parse the integer data-format version from `.jade/version` in a content map.
// Returns null if the file is absent or unparseable.
export function parseDataVersion(contentMap) {
  const raw = contentMap?.get('.jade/version')
  if (!raw) return null
  const n = parseInt(raw.trim().replace(/^v/, ''), 10)
  return Number.isFinite(n) ? n : null
}

// ─── IndexedDB persistence ────────────────────────────────────────────────────

export async function getCachedRepo() {
  const db = await getDB()
  return (await db.get('repo', 'data')) ?? null
}

export function setCachedRepo(data) {
  return getDB().then(db => db.put('repo', data, 'data')).catch(() => {})
}

// ─── Module-load preload ──────────────────────────────────────────────────────
// Kick off the IDB read once, at import time, so the data is likely ready by
// the time the first component renders. `_preloaded` holds the resolved value
// for synchronous access; `preloadPromise` is awaitable for the not-yet-ready case.

let _preloaded = null
export const preloadPromise = getCachedRepo()
  .then(d => { _preloaded = d; return d })
  .catch(() => { _preloaded = null; return null })

// The preloaded repo record if the IDB read has already resolved, else null.
// Always returns null synchronously when the read is still in flight — callers
// that need the value either way should await `preloadPromise`.
export function getPreloadedRepo() {
  return _preloaded
}

// ─── In-memory session cache ──────────────────────────────────────────────────
// Survives in-app navigation (component remounts), lost on page reload.

let _session = null  // { repoUrl, items (filtered), contentMap, truncated }

export function getSessionCache() {
  return _session
}

export function setSessionCache(data) {
  _session = data
}

export function getContentFromCache(path) {
  return _session?.contentMap?.get(path)
}

// Reflect an edited file's new content back into the read caches (§6.1 render
// half), so an in-app navigation or a reload shows the post-edit content rather
// than the pre-edit cached copy. Updates the in-memory session cache and the
// persisted IndexedDB cache; the tree-item SHAs go briefly stale but self-heal
// on the next background refresh.
export async function updateCachedFile(repoUrl, path, content) {
  const sess = _session
  if (sess?.repoUrl === repoUrl && sess.contentMap) {
    sess.contentMap.set(path, content)
  }
  try {
    const cached = await getCachedRepo()
    if (cached?.repoUrl === repoUrl && cached.contentMap) {
      cached.contentMap.set(path, content)
      await setCachedRepo(cached)
    }
  } catch { /* cache update is best-effort */ }
}
