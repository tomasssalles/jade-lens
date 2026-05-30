export function normalizeWikilinkPath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/^\//, '')
}

// Strip any non-dotfile extension; join path segments with ' / '.
// e.g. 'Projects/New language.json' → 'Projects / New language'
// e.g. '.gitignore' → '.gitignore' (dotfile: no extension to strip)
export function formatPath(p) {
  return p.replace(/(?<=[^/])\.[^./]+$/i, '').split('/').filter(Boolean).join(' / ')
}
