import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCardColor, getTextColor, getBorderColor, getTitleColor, getUnlockedLockColor } from './viewerSettings'
import { appendPointer } from './edit/jsonPointer'
import { resolveDecimalSeparator, formatNumberForDisplay, parseNumberInput, isPartialNumberInput, mapToSeparator } from './edit/numberFormat'
import { classifyStringValue, wikilinkTarget, toWikilink, toDateInputValue, datetimeHasSeconds, fromDateInputValue } from './edit/valueType'
import FileBreadcrumb from './FileBreadcrumb'
import MarkdownRenderer from './MarkdownRenderer'
import DateNode from './nodes/DateNode'
import WikilinkNode from './nodes/WikilinkNode'
import LockClosedIcon from './assets/lock-closed.svg?react'
import LockOpenIcon from './assets/lock-open.svg?react'
import PencilIcon from './assets/pencil.svg?react'

// Edit-mode context: `{ editing, onValueEdit, repoFiles }`. `editing` is true only
// when the view is unlocked (docs/web/editing.md "Edit-mode lock");
// `onValueEdit(pointer, newValue)` commits one JSON value micro-edit; `repoFiles`
// is the list of repo-relative paths offered by the wikilink picker. All read by
// the recursive RenderValue without prop-threading.
const EditModeContext = createContext({ editing: false, onValueEdit: null, repoFiles: [] })

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

// Shared popover chrome for leaf-value editors (boolean picker, number editor).
function popoverStyle(s) {
  return {
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
  }
}

// Open/close state for a leaf editor's popover, with outside-click / Escape
// dismissal. The handler checks the whole wrapper (pencil + popover), so clicking
// the pencil itself counts as "inside" and toggles cleanly rather than closing
// then reopening.
function useLeafPicker() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
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
  return { open, setOpen, wrapRef }
}

// A leaf card's content: the read display on the left, and — in edit mode — a
// framed pencil at the right edge that opens a type-specific popover.
// `renderPopover(close)` supplies the popover body.
function EditableLeaf({ display, editing, s, renderPopover }) {
  const { open, setOpen, wrapRef } = useLeafPicker()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ minWidth: 0 }}>{display}</span>
      {editing && (
        <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', marginLeft: 'auto', flexShrink: 0 }}>
          <PencilButton s={s} onClick={() => setOpen(o => !o)} />
          {open && renderPopover(() => setOpen(false))}
        </span>
      )}
    </div>
  )
}

// Boolean picker popover: the two choices, the current one highlighted. Picking
// commits (the upstream no-op guard ignores re-picking the same value).
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
    <div style={popoverStyle(s)}>
      {option(true, '✓ true')}
      {option(false, '✗ false')}
    </div>
  )
}

// Number editor popover: a type-in field — no spinners or wheels. `inputMode`
// "decimal" brings up the numeric keypad on mobile; keystrokes and paste are
// filtered to a valid partial number, with whichever decimal key is pressed
// mapped to the configured separator. Enter or the ✓ button commits; Escape /
// outside-click cancels (handled by the wrapper).
function NumberEditor({ value, sep, onCommit, s }) {
  const [text, setText] = useState(() => formatNumberForDisplay(value, sep))
  const inputRef = useRef(null)
  useEffect(() => {
    const el = inputRef.current
    if (el) { el.focus(); el.select() }
  }, [])
  const parsed = parseNumberInput(text, sep)
  const valid = parsed !== null
  return (
    <div style={{ ...popoverStyle(s), padding: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label="New value"
        value={text}
        onChange={(e) => {
          const mapped = mapToSeparator(e.target.value, sep)
          if (isPartialNumberInput(mapped, sep)) setText(mapped)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && valid) { e.preventDefault(); onCommit(parsed) } }}
        style={{
          width: '7rem',
          font: 'inherit',
          color: 'inherit',
          padding: '3px 6px',
          borderRadius: 4,
          border: `1px solid ${getBorderColor(s)}`,
          background: getCardColor(1, s),
        }}
      />
      <button
        type="button"
        onClick={() => { if (valid) onCommit(parsed) }}
        disabled={!valid}
        aria-label="Set value"
        style={{
          flexShrink: 0,
          cursor: valid ? 'pointer' : 'default',
          opacity: valid ? 1 : 0.4,
          color: getTitleColor(s),
          background: 'rgba(0,0,0,0.04)',
          border: `1px solid ${getBorderColor(s)}`,
          borderRadius: 4,
          padding: '3px 8px',
          font: 'inherit',
        }}
      >
        ✓
      </button>
    </div>
  )
}

// Shared little ✓ commit button for the leaf editors.
function CommitButton({ valid, onCommit, s }) {
  return (
    <button
      type="button"
      onClick={() => { if (valid) onCommit() }}
      disabled={!valid}
      aria-label="Set value"
      style={{
        flexShrink: 0,
        cursor: valid ? 'pointer' : 'default',
        opacity: valid ? 1 : 0.4,
        color: getTitleColor(s),
        background: 'rgba(0,0,0,0.04)',
        border: `1px solid ${getBorderColor(s)}`,
        borderRadius: 4,
        padding: '3px 8px',
        font: 'inherit',
      }}
    >
      ✓
    </button>
  )
}

// Date / datetime editor popover: a native picker bound to the value's local
// part. For a zoned datetime the original offset (Z / ±hh:mm) is preserved
// across the edit — only the wall-clock value is touched (see valueType.js).
function DateEditor({ value, type, onCommit, s }) {
  const [text, setText] = useState(() => toDateInputValue(value, type))
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const out = fromDateInputValue(text, type, value)
  const valid = out !== null
  // Only show the seconds field when the original datetime carried seconds.
  const step = type === 'datetime' && datetimeHasSeconds(value) ? 1 : undefined
  return (
    <div style={{ ...popoverStyle(s), padding: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        ref={inputRef}
        type={type === 'date' ? 'date' : 'datetime-local'}
        step={step}
        aria-label="New value"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && valid) { e.preventDefault(); onCommit(out) } }}
        style={{
          font: 'inherit',
          color: 'inherit',
          padding: '3px 6px',
          borderRadius: 4,
          border: `1px solid ${getBorderColor(s)}`,
          background: getCardColor(1, s),
        }}
      />
      <CommitButton valid={valid} onCommit={() => onCommit(out)} s={s} />
    </div>
  )
}

// Wikilink editor popover: a filterable list of repo files; picking one commits
// `[[path]]`. When no file list is available it degrades to a free-text path
// field so a link can still be retargeted by hand.
function WikilinkEditor({ value, repoFiles, onCommit, s }) {
  const current = wikilinkTarget(value)
  const hasList = repoFiles.length > 0
  // List mode: the field filters, so it starts empty. Free-text mode: the field
  // *is* the path, so it starts at the current target for easy retargeting.
  const [query, setQuery] = useState(() => (hasList ? '' : current))
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const matches = useMemo(() => {
    if (!hasList) return []
    const q = query.trim().toLowerCase()
    const filtered = q ? repoFiles.filter((p) => p.toLowerCase().includes(q)) : repoFiles
    return filtered.slice(0, 50)
  }, [repoFiles, query, hasList])

  // Free-text fallback: commit whatever path is typed.
  const typed = toWikilink(query)
  const typedValid = typed !== null && typed !== value

  const rowButton = (path) => (
    <button
      key={path}
      type="button"
      onClick={() => onCommit(toWikilink(path))}
      title={path}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '5px 12px',
        cursor: 'pointer',
        font: 'inherit',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        border: 'none',
        borderBottom: `1px solid ${getBorderColor(s)}`,
        background: path === current ? getTitleColor(s) : 'transparent',
        color: path === current ? '#fff' : 'inherit',
      }}
    >
      {path}
    </button>
  )

  return (
    <div style={{ ...popoverStyle(s), padding: 8, width: '16rem', maxWidth: '80vw' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          aria-label={hasList ? 'Filter files' : 'Link target path'}
          placeholder={hasList ? 'Filter files…' : 'path/to/file.md'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (hasList) {
              if (matches.length > 0) { e.preventDefault(); onCommit(toWikilink(matches[0])) }
            } else if (typedValid) {
              e.preventDefault(); onCommit(typed)
            }
          }}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            font: 'inherit',
            color: 'inherit',
            padding: '3px 6px',
            borderRadius: 4,
            border: `1px solid ${getBorderColor(s)}`,
            background: getCardColor(1, s),
          }}
        />
        {!hasList && <CommitButton valid={typedValid} onCommit={() => onCommit(typed)} s={s} />}
      </div>
      {hasList && (
        <div style={{ marginTop: 6, maxHeight: '12rem', overflowY: 'auto', border: `1px solid ${getBorderColor(s)}`, borderRadius: 4 }}>
          {matches.length > 0
            ? matches.map(rowButton)
            : <div style={{ padding: '6px 12px', opacity: 0.6 }}>No matching files</div>}
        </div>
      )}
    </div>
  )
}

// ─── Recursive value renderer ─────────────────────────────────────────────────

// A boolean leaf. Read-only it's a plain ✓/✗. In edit mode (view unlocked and
// the file editable) a framed pencil at the card's right edge opens a picker —
// there's no in-place flip; every type is edited through its picker.
function BoolRow({ value, pointer, keyLabel, s }) {
  const { editing, onValueEdit } = useContext(EditModeContext)
  const display = (
    <>
      {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
      <span style={{ opacity: value ? 1 : 0.5 }}>{value ? '✓' : '✗'}</span>
    </>
  )
  return (
    <EditableLeaf
      display={display}
      editing={editing && !!onValueEdit}
      s={s}
      renderPopover={(close) => (
        <BoolPicker value={value} s={s} onPick={(v) => { close(); onValueEdit(pointer, v) }} />
      )}
    />
  )
}

// A number leaf — integers and floats alike. Shown with the configured decimal
// separator; in edit mode the pencil opens the type-in NumberEditor.
function NumRow({ value, pointer, keyLabel, s }) {
  const { editing, onValueEdit } = useContext(EditModeContext)
  const sep = resolveDecimalSeparator(s.decimalSeparator)
  const display = (
    <>
      {keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>}
      {formatNumberForDisplay(value, sep)}
    </>
  )
  return (
    <EditableLeaf
      display={display}
      editing={editing && !!onValueEdit}
      s={s}
      renderPopover={(close) => (
        <NumberEditor value={value} sep={sep} s={s} onCommit={(n) => { close(); onValueEdit(pointer, n) }} />
      )}
    />
  )
}

// A string leaf. Read-only it renders as inline markdown (links, dates, etc.).
// In edit mode, if the whole string is exactly one date / datetime / wikilink it
// gains a pencil opening the matching editor; any other string stays plain (full
// text editing is a separate, larger feature — see docs/web/editing.md).
function StringRow({ value, pointer, keyLabel, s, onWikilinkClick }) {
  const { editing, onValueEdit, repoFiles } = useContext(EditModeContext)
  const editable = editing && !!onValueEdit
  const type = editable ? classifyStringValue(value) : 'plain'
  const label = keyLabel && <span style={{ fontWeight: s.keyFontWeight }}>{keyLabel}: </span>

  if (type === 'date' || type === 'datetime') {
    return (
      <EditableLeaf
        display={<>{label}<DateNode iso={value.trim()} /></>}
        editing
        s={s}
        renderPopover={(close) => (
          <DateEditor value={value.trim()} type={type} s={s} onCommit={(v) => { close(); onValueEdit(pointer, v) }} />
        )}
      />
    )
  }

  if (type === 'wikilink') {
    return (
      <EditableLeaf
        display={<>{label}<WikilinkNode path={wikilinkTarget(value)} onWikilinkClick={onWikilinkClick} /></>}
        editing
        s={s}
        renderPopover={(close) => (
          <WikilinkEditor value={value.trim()} repoFiles={repoFiles} s={s} onCommit={(v) => { close(); onValueEdit(pointer, v) }} />
        )}
      />
    )
  }

  return (
    <>
      {label}
      <MarkdownRenderer content={value} onWikilinkClick={onWikilinkClick} inline />
    </>
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
        <NumRow value={value} pointer={pointer} keyLabel={keyLabel} s={s} />
      </Card>
    )
  }

  if (typeof value === 'string') {
    return (
      <Card depth={depth} s={s} isWide={isWide}>
        <StringRow value={value} pointer={pointer} keyLabel={keyLabel} s={s} onWikilinkClick={onWikilinkClick} />
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

export default function JsonCardViewer({ data, filePath, settings, onWikilinkClick, onValueEdit = null, repoFiles = [], onBack }) {
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

  const editMode = useMemo(() => ({ editing: unlocked, onValueEdit, repoFiles }), [unlocked, onValueEdit, repoFiles])

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
