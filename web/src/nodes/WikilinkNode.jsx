import { normalizeWikilinkPath, formatPath } from '../pathUtils'

export default function WikilinkNode({ path, onWikilinkClick }) {
  const normalized = normalizeWikilinkPath(path)
  return (
    <a
      href="#"
      onClick={e => { e.preventDefault(); onWikilinkClick?.(normalized) }}
      className="jl-wikilink"
    >
      {formatPath(normalized)}
    </a>
  )
}
