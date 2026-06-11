import { getTitleColor, getBorderColor, getCardColor } from './viewerSettings'
import { formatFileBreadcrumb } from './pathUtils'
import ArrowLeftIcon from './assets/arrow-left.svg?react'

// `right` renders an optional control (e.g. the edit-mode lock) pinned to the far
// end of the row. `sticky` keeps the whole breadcrumb pinned to the top of the
// scroll container so that control never scrolls away (docs/web/editing.md).
export default function FileBreadcrumb({ filePath, s, onBack, right = null, sticky = false }) {
  const titleColor = getTitleColor(s)
  const stickyStyle = sticky
    ? {
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: getCardColor(0, s),
        // Pull the bar up over the page's top padding and re-pad it, so its
        // background covers content scrolling underneath with no sliver above.
        marginTop: -s.cardPaddingY * 2,
        paddingTop: s.cardPaddingY * 2,
      }
    : null
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontWeight: 700,
      fontSize: s.fontSize + 2,
      color: titleColor,
      marginBottom: s.siblingGap + 6,
      paddingBottom: 8,
      borderBottom: `1px solid ${getBorderColor(s)}55`,
      wordBreak: 'break-word',
      ...stickyStyle,
    }}>
      {onBack && (
        <button onClick={onBack} aria-label="Back" style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          color: titleColor,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <ArrowLeftIcon style={{ width: s.fontSize + 4, height: s.fontSize + 4 }} />
        </button>
      )}
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>{formatFileBreadcrumb(filePath)}</span>
      {right}
    </div>
  )
}
