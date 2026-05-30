function formatDate(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d)) return iso
    if (iso.length === 10) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return iso }
}

export default function DateNode({ iso }) {
  return <span className="jl-date" title={iso}>{formatDate(iso)}</span>
}
