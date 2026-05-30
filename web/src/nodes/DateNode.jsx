import { useContext } from 'react'
import { TimeFormatContext } from '../TimeFormatContext'

// Intl-based auto-detection. Chrome on Android with en-US locale ignores the
// OS 24h setting and always returns h12, so this is only a best-effort default.
const HOUR12_AUTO = (() => {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    return hourCycle === 'h11' || hourCycle === 'h12'
  } catch {
    return undefined
  }
})()

function formatDate(iso, timeFormat) {
  try {
    const d = new Date(iso)
    if (isNaN(d)) return iso
    if (iso.length === 10) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
    const hour12 = timeFormat === '12h' ? true
      : timeFormat === '24h' ? false
      : HOUR12_AUTO
    const opts = {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...(hour12 !== undefined && { hour12 }),
    }
    return d.toLocaleString(undefined, opts)
  } catch { return iso }
}

export default function DateNode({ iso }) {
  const timeFormat = useContext(TimeFormatContext)
  return <span className="jl-date" title={iso}>{formatDate(iso, timeFormat)}</span>
}
