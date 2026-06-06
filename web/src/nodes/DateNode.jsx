import { useContext } from 'react'
import { TimeFormatContext } from '../TimeFormatContext'
import { splitDatetime, parseZoneOffsetMinutes, formatZoneSuffix } from '../edit/valueType'

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

const LOCAL_PART_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/

// Build a Date whose UTC fields equal the value's stored wall-clock components.
// Formatting it with `timeZone: 'UTC'` then renders the value in its own frame
// with no conversion — the design decision is to never shift a stored datetime
// (a flight's local arrival time must read as that local time, not the viewer's).
function utcDateFromParts(localPart) {
  const m = String(localPart).match(LOCAL_PART_RE)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))
  return isNaN(d) ? null : d
}

// Returns { text, suffix } — the localized wall-clock and, for a zoned datetime
// whose offset isn't the viewer's current local offset, a small zone marker
// (`UTC` / `+02:00`). Naive and date-only values, and zoned values that happen
// to match the local offset, get no suffix.
function formatDate(iso, timeFormat) {
  // Date-only: no time, no zone marker.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = utcDateFromParts(iso)
    if (!d) return { text: iso, suffix: '' }
    return {
      text: d.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }),
      suffix: '',
    }
  }

  const parts = splitDatetime(iso)
  const d = parts ? utcDateFromParts(parts.local) : null
  if (!parts || !d) return { text: iso, suffix: '' }

  const hour12 = timeFormat === '12h' ? true : timeFormat === '24h' ? false : HOUR12_AUTO
  const text = d.toLocaleString(undefined, {
    timeZone: 'UTC',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...(hour12 !== undefined && { hour12 }),
  })

  // Zone marker for zoned values not currently in the viewer's local offset.
  const offsetMin = parseZoneOffsetMinutes(parts.zone)
  let suffix = ''
  if (offsetMin !== null) {
    const instant = new Date(iso)
    const browserOffsetMin = isNaN(instant) ? null : -instant.getTimezoneOffset()
    if (browserOffsetMin === null || offsetMin !== browserOffsetMin) {
      suffix = formatZoneSuffix(offsetMin)
    }
  }
  return { text, suffix }
}

export default function DateNode({ iso }) {
  const timeFormat = useContext(TimeFormatContext)
  const { text, suffix } = formatDate(iso, timeFormat)
  return (
    <span className="jl-date" title={iso}>
      {text}{suffix && <span className="jl-date-zone"> {suffix}</span>}
    </span>
  )
}
