import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCardColor, getTextColor, getBorderColor, getTitleColor, getUnlockedLockColor } from './viewerSettings'
import { appendPointer } from './edit/jsonPointer'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'
import LockClosedIcon from './assets/lock-closed.svg?react'
import LockOpenIcon from './assets/lock-open.svg?react'
import PencilIcon from './assets/pencil.svg?react'

// Edit-mode context: `{ editing, onValueEdit }`. `editing` is true only when the
// view is unlocked (docs/web/editing.md "Edit-mode lock"); `onValueEdit(pointer,
// newValue)` commits one JSON value micro-edit. Both are read by the recursive
// RenderValue without prop-threading.
const EditModeContext = createContext({ editing: false, onValueEdit: null })

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

// ─── Edit-mode controls ───────────────────────────────────────────────────────

// The lock that gates editing. Locked = read-only, drawn in the theme colour;
// unlocked = edit mode, drawn in a blazing red (or a contrasting fallback when
// the theme is itself red). A single tap toggles it (docs/web/editing.md).
function LockButton({ unlocked, onToggle, s }) {
  const color = unlocked ? getUnlockedLockColor(s) : getTitleColor(s)
  const Icon = unlocked ? LockOpenIcon : LockClosedIcon
  return (
    <button
      onClick={onToggle}
      aria-label={unlocked ? 'Lock (leave edit mode)' : 'Unlock to edit'}
      aria-pressed={unlocked}
      title={unlocked ? 'Editing — tap to lock' : 'Tap to edit'}
      style={{
        marginLeft: 'auto',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: s.fontSize + 16,
        height: s.fontSize + 16,
        padding: 0,
        cursor: 'pointer',
        color,
        background: unlocked ? `${color}22` : 'transparent',
        border: `2px solid ${color}`,
        borderRadius: 6,
        transition: 'color 0.12s, border-color 0.12s, background 0.12s',
      }}
    >
      <Icon style={{ width: s.fontSize + 2, height: s.fontSize + 2 }} />
    </button>
  )
}

// A little framed pencil — the per-field edit trigger shown on editable leaf
// cards while the view is unlocked.
function PencilButton({ onClick, s }) {
  return (
    <button
      onClick={onClick}
      aria-label="Edit value"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: s.fontSize + 10,
        height: s.fontSize + 10,
        padding: 0,
        cursor: 'pointer',
        color: getTitleColor(s),
        background: 'rgba(0,0,0,0.04)',
        border: `1px solid ${getBorderColor(s)}`,
        borderRadius: 4,
      }}
    >
      <PencilIcon style={{ width: s.fontSize - 2, height: s.fontSize - 2 }} />
    </button>
  )
}

// Boolean picker popover: the two choices, the current one highlighted. Picking
// commits (the upstream no-op guard ignores re-picking the same value).
// Presentational only — open/close (incl. outside-click) is owned by BoolRow so
// that clicking the pencil itself counts as "inside".
function BoolPicker({ value, onPick, s }) {
  const option = (v, label) => (
    <button
      onClick={() => onPick(v)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '5px 12px',
        cursor: 'pointer',
        font: 'inherit',
        whiteSpace: 'nowrap',
        border: 'none',
        background: v === value ? getTitleColor(s) : 'transparent',
        color: v === value ? '#fff' : 'inherit',
      }}
    >
      {label}
    </button>
  )
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        zIndex: 10,
        background: getCardColor(0, s),
        color: getTextColor(0, s),
        border: `1px solid ${getBorderColor(s)}`,
        borderRadius: 5,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      {option(true, '✓ true')}
      {option(false, '✗ false')}
    </div>
  )
}

// ─── Recursive value renderer ─────────────────────────────────────────────────

// A boolean leaf. Read-only it's a plain ✓/✗. In edit mode (view unlocked and
// the file editable) a framed pencil sits at the card's right edge and opens a
// picker — there's no in-place flip; every type is edited through its picker.
function BoolRow({ value, pointer, keyLabel, s }) {
  const { editing, onValueEdit } = useContext(EditModeContext)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const showEditor = editing && !!onValueEdit

  // Close the picker on outside-click / Escape. The handler checks the wrapper
  // (pencil + popover), so clicking the pencil itself is "inside" and lets its
  // own onClick toggle cleanly rather than closing then reopening.
  useEffect(() => {
    if (!open) return
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ minWidth: 0 }}>
        {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
        <span style={{ opacity: value ? 1 : 0.5 }}>{value ? '✓' : '✗'}</span>
      </span>
      {showEditor && (
        <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', marginLeft: 'auto', flexShrink: 0 }}>
          <PencilButton s={s} onClick={() => setOpen(o => !o)} />
          {open && (
            <BoolPicker
              value={value}
              s={s}
              onPick={(v) => { setOpen(false); onValueEdit(pointer, v) }}
            />
          )}
        </span>
      )}
    </div>
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
        <BoolRow value={value} pointer={pointer} keyLabel={keyLabel} s={s} />
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

  // The edit-mode lock. Locked (read-only) by default; opening a different file
  // re-locks (auto-relock on leaving the view — docs/web/editing.md). The lock
  // only appears when the file is actually editable (onValueEdit provided).
  const canEdit = !!onValueEdit
  const [unlocked, setUnlocked] = useState(false)
  // Re-lock when the viewer switches to a different file (auto-relock on leaving
  // the view) — done during render via a previous-value sentinel rather than an
  // effect, the React-recommended way to reset state on a prop change.
  const [prevPath, setPrevPath] = useState(filePath)
  if (prevPath !== filePath) {
    setPrevPath(filePath)
    setUnlocked(false)
  }

  const editMode = useMemo(() => ({ editing: unlocked, onValueEdit }), [unlocked, onValueEdit])

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
    <EditModeContext.Provider value={editMode}>
      {/* No `overflow` on this wrapper: an intermediate scroll container here
          would trap the breadcrumb's `position: sticky`. Horizontal scrolling for
          wide cards lives on the inner wrapper below instead. */}
      <div style={{
        background: getCardColor(0, settings),
        minHeight: '100%',
        padding: `${settings.cardPaddingY * 2}px ${settings.cardPaddingX * 2}px`,
        boxSizing: 'border-box',
      }}>
        <FileBreadcrumb
          filePath={filePath}
          s={settings}
          onBack={onBack}
          sticky={canEdit}
          right={canEdit && (
            <LockButton unlocked={unlocked} onToggle={() => setUnlocked(v => !v)} s={settings} />
          )}
        />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: settings.siblingGap + 4,
          overflowX: isWide ? 'auto' : 'hidden',
          // Slack below the last card so a picker opening under it isn't clipped
          // by this wrapper's overflow.
          paddingBottom: settings.fontSize * 4,
        }}>
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
    </EditModeContext.Provider>
  )
}
