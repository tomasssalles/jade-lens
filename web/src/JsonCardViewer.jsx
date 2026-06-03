import { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react'
import { getCardColor, getTextColor, getBorderColor } from './viewerSettings'
import { useEditGesture } from './edit/useEditGesture'
import { appendPointer } from './edit/jsonPointer'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'

// onValueEdit(pointer, newValue): commit a single JSON value micro-edit. Provided
// at the top so the recursive RenderValue can reach it without prop-threading.
const JsonValueEditContext = createContext(null)

// Subscribe to a media query and return whether it currently matches.
// Re-renders only when the match flips, not on every resize pixel.
function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ─── Value helpers ────────────────────────────────────────────────────────────

function isShortStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every(
    x => typeof x === 'string' && x.length < 40 && !/\[\[/.test(x) && !/^https?:\/\//.test(x)
  )
}

// ─── Card primitives ──────────────────────────────────────────────────────────

function Card({ depth, s, isWide, children }) {
  const indent = isWide ? Math.max(0, depth - 1) * s.indentPerLevel : 0
  return (
    <div style={{
      background: getCardColor(depth, s),
      color: getTextColor(depth, s),
      borderRadius: s.borderRadius,
      border: `${s.borderWidth}px solid ${getBorderColor(s)}`,
      padding: `${s.cardPaddingY}px ${s.cardPaddingX}px`,
      marginLeft: indent,
      minWidth: isWide ? s.minCardWidth : undefined,
      fontSize: s.fontSize,
      lineHeight: 1.5,
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    }}>
      {children}
    </div>
  )
}

function Collapsible({ label, depth, s, isWide, children, count }) {
  const [open, setOpen] = useState(true)
  return (
    <Card depth={depth} s={s} isWide={isWide}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 6, userSelect: 'none' }}
      >
        <span style={{
          display: 'inline-block',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
          fontSize: '0.7em',
          color: getBorderColor(s),
        }}>▶</span>
        <span style={{ fontWeight: s.keyFontWeight }}>{label}</span>
        {count !== undefined && <span style={{ fontSize: '0.82em', opacity: 0.5 }}>({count})</span>}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.siblingGap, marginTop: s.siblingGap + 2 }}>
          {children}
        </div>
      )}
    </Card>
  )
}

// ─── Recursive value renderer ─────────────────────────────────────────────────

// An editable boolean value. The edit gesture (long-press / double-click) flips
// it; non-editable (no onValueEdit in context) it's a plain ✓/✗ as before.
function BoolValue({ value, pointer }) {
  const onValueEdit = useContext(JsonValueEditContext)
  const editable = !!onValueEdit
  const gesture = useEditGesture(() => onValueEdit?.(pointer, !value))
  const editStyle = editable
    ? {
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'manipulation',
        padding: '0 6px',
        borderRadius: 3,
        background: 'rgba(0,0,0,0.05)',
      }
    : null
  return (
    <span
      {...(editable ? gesture : {})}
      style={{ opacity: value ? 1 : 0.5, ...editStyle }}
      title={editable ? 'Long-press or double-click to toggle' : undefined}
    >
      {value ? '✓' : '✗'}
    </span>
  )
}

function RenderValue({ value, depth, s, isWide, keyLabel, pointer, onWikilinkClick }) {
  if (value === null) {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        <span style={{ opacity: 0.35, fontStyle: 'italic' }}>∅</span>
      </Card>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        <BoolValue value={value} pointer={pointer} />
      </Card>
    )
  }

  if (typeof value === 'number') {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        {value}
      </Card>
    )
  }

  if (typeof value === 'string') {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        <MarkdownRenderer content={value} onWikilinkClick={onWikilinkClick} inline />
      </Card>
    )
  }

  if (isShortStringArray(value)) {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'middle' }}>
          {value.map((str, i) => (
            <span key={i} style={{
              background: 'rgba(0,0,0,0.07)', borderRadius: 3, padding: '0 6px', fontSize: '0.9em',
            }}>{str}</span>
          ))}
        </span>
      </Card>
    )
  }

  if (Array.isArray(value)) {
    return (
      <Collapsible label={keyLabel || 'Items'} depth={depth} s={s} isWide={isWide} count={value.length}>
        {value.map((item, i) => (
          <RenderValue key={i} value={item} depth={depth + 1} s={s} isWide={isWide} pointer={`${pointer}/${i}`} onWikilinkClick={onWikilinkClick} />
        ))}
      </Collapsible>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (keyLabel) {
      return (
        <Collapsible label={keyLabel} depth={depth} s={s} isWide={isWide}>
          {entries.map(([k, v]) => (
            <RenderValue key={k} value={v} depth={depth + 1} s={s} isWide={isWide} keyLabel={k} pointer={appendPointer(pointer, k)} onWikilinkClick={onWikilinkClick} />
          ))}
        </Collapsible>
      )
    }
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.siblingGap }}>
          {entries.map(([k, v]) => (
            <RenderValue key={k} value={v} depth={depth + 1} s={s} isWide={isWide} keyLabel={k} pointer={appendPointer(pointer, k)} onWikilinkClick={onWikilinkClick} />
          ))}
        </div>
      </Card>
    )
  }

  return <Card depth={depth} s={s} isWide={isWide}>{String(value)}</Card>
}

// ─── Top-level export ─────────────────────────────────────────────────────────

export default function JsonCardViewer({ data, filePath, settings, onWikilinkClick, onValueEdit = null, onBack }) {
  // Track only the wide/narrow boolean, not the raw width, so we re-render on
  // the breakpoint crossing rather than on every resize pixel.
  const isWide = useMediaQuery(`(min-width: ${settings.wideBreakpoint}px)`)

  // Each top item carries its JSON Pointer so value edits map back to the source.
  let topItems
  if (Array.isArray(data)) {
    topItems = data.map((item, i) => ({ key: String(i), value: item, label: null, pointer: `/${i}` }))
  } else if (data && typeof data === 'object') {
    const keys = Object.keys(data)
    if (keys.length === 1 && Array.isArray(data[keys[0]])) {
      // The viewer unwraps a single `{ key: [...] }` — the items live under /key.
      const base = appendPointer('', keys[0])
      topItems = data[keys[0]].map((item, i) => ({ key: String(i), value: item, label: null, pointer: `${base}/${i}` }))
    } else {
      topItems = Object.entries(data).map(([k, v]) => ({ key: k, value: v, label: k, pointer: appendPointer('', k) }))
    }
  } else {
    topItems = [{ key: '0', value: data, label: null, pointer: '' }]
  }

  return (
    <JsonValueEditContext.Provider value={onValueEdit}>
      <div style={{
        background: getCardColor(0, settings),
        minHeight: '100%',
        padding: `${settings.cardPaddingY * 2}px ${settings.cardPaddingX * 2}px`,
        boxSizing: 'border-box',
        overflowX: isWide ? 'auto' : 'hidden',
      }}>
        <FileBreadcrumb filePath={filePath} s={settings} onBack={onBack} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: settings.siblingGap + 4 }}>
          {topItems.map(({ key, value, label, pointer }) => (
            <RenderValue
              key={key}
              value={value}
              depth={1}
              s={settings}
              isWide={isWide}
              keyLabel={label}
              pointer={pointer}
              onWikilinkClick={onWikilinkClick}
            />
          ))}
        </div>
      </div>
    </JsonValueEditContext.Provider>
  )
}
