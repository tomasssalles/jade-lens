export function normalizeWikilinkPath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/^\//, '')
}

// Strip any non-dotfile extension; join path segments with ' / '.
// e.g. 'Projects/New language.json' → 'Projects / New language'
// e.g. '.gitignore' → '.gitignore' (dotfile: no extension to strip)
export function formatPath(p) {
  return p.replace(/(?<=[^/])\.[^./]+$/i, '').split('/').filter(Boolean).join(' / ')
}

const _SIDECARS_SUFFIX = '.sidecars'

/**
 * Format a file path for display in the breadcrumb top bar.
 *
 * Sidecar paths are displayed as `dir / stem[json/pointer/segments]` so the
 * user sees the logical location (owner JSON + field path) rather than the
 * raw filesystem path.
 *
 * e.g. 'Garden.sidecars/notes.md'                         → 'Garden[notes]'
 * e.g. 'Projects/Garden.sidecars/comparisons/0/desc.md'   → 'Projects / Garden[comparisons/0/desc]'
 *
 * Non-sidecar paths delegate to formatPath.
 */
export function formatFileBreadcrumb(filePath) {
  const parts = filePath.split('/')
  const sidecarIdx = parts.findIndex((p) => p.endsWith(_SIDECARS_SUFFIX))
  if (sidecarIdx < 0) return formatPath(filePath)

  const dirParts = parts.slice(0, sidecarIdx)
  const stem = parts[sidecarIdx].slice(0, -_SIDECARS_SUFFIX.length)
  const relParts = parts.slice(sidecarIdx + 1)
  if (relParts.length > 0) {
    relParts[relParts.length - 1] = relParts[relParts.length - 1].replace(/\.md$/, '')
  }

  const base = [...dirParts, stem].join(' / ')
  const jsonPath = relParts.join('/')
  return jsonPath ? `${base}[${jsonPath}]` : base
}
