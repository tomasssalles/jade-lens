import { useEffect, useState } from 'react'
import { getCardColor, getTextColor, getBorderColor } from './viewerSettings'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'

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

function RenderValue({ value, depth, s, isWide, keyLabel, onWikilinkClick }) {
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
        <span style={{ opacity: value ? 1 : 0.5 }}>{value ? '✓' : '✗'}</span>
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
          <RenderValue key={i} value={item} depth={depth + 1} s={s} isWide={isWide} onWikilinkClick={onWikilinkClick} />
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
            <RenderValue key={k} value={v} depth={depth + 1} s={s} isWide={isWide} keyLabel={k} onWikilinkClick={onWikilinkClick} />
          ))}
        </Collapsible>
      )
    }
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: s.siblingGap }}>
          {entries.map(([k, v]) => (
            <RenderValue key={k} value={v} depth={depth + 1} s={s} isWide={isWide} keyLabel={k} onWikilinkClick={onWikilinkClick} />
          ))}
        </div>
      </Card>
    )
  }

  return <Card depth={depth} s={s} isWide={isWide}>{String(value)}</Card>
}

// ─── Top-level export ─────────────────────────────────────────────────────────

export default function JsonCardViewer({ data, filePath, settings, onWikilinkClick, onBack }) {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const isWide = windowWidth >= settings.wideBreakpoint

  let topItems
  if (Array.isArray(data)) {
    topItems = data.map((item, i) => ({ key: String(i), value: item, label: null }))
  } else if (data && typeof data === 'object') {
    const keys = Object.keys(data)
    if (keys.length === 1 && Array.isArray(data[keys[0]])) {
      topItems = data[keys[0]].map((item, i) => ({ key: String(i), value: item, label: null }))
    } else {
      topItems = Object.entries(data).map(([k, v]) => ({ key: k, value: v, label: k }))
    }
  } else {
    topItems = [{ key: '0', value: data, label: null }]
  }

  return (
    <div style={{
      background: getCardColor(0, settings),
      minHeight: '100%',
      padding: `${settings.cardPaddingY * 2}px ${settings.cardPaddingX * 2}px`,
      boxSizing: 'border-box',
      overflowX: isWide ? 'auto' : 'hidden',
    }}>
      <FileBreadcrumb filePath={filePath} s={settings} onBack={onBack} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: settings.siblingGap + 4 }}>
        {topItems.map(({ key, value, label }) => (
          <RenderValue
            key={key}
            value={value}
            depth={1}
            s={settings}
            isWide={isWide}
            keyLabel={label}
            onWikilinkClick={onWikilinkClick}
          />
        ))}
      </div>
    </div>
  )
}
