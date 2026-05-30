// Detect the browser/OS hour cycle preference once at module load.
// Intl.DateTimeFormat.resolvedOptions().hourCycle reflects the OS-level
// 24h/12h setting on modern Android Chrome even when navigator.language
// is an English locale — which toLocaleString() alone does not do.
const HOUR12 = (() => {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    return hourCycle === 'h11' || hourCycle === 'h12'
  } catch {
    return undefined
  }
})()

function formatDate(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d)) return iso
    if (iso.length === 10) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
    const opts = {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...(HOUR12 !== undefined && { hour12: HOUR12 }),
    }
    return d.toLocaleString(undefined, opts)
  } catch { return iso }
}

export default function DateNode({ iso }) {
  return <span className="jl-date" title={iso}>{formatDate(iso)}</span>
}
