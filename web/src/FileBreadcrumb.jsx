import { getTitleColor, getBorderColor } from './viewerSettings'
import { formatPath } from './pathUtils'
import ArrowLeftIcon from './assets/arrow-left.svg?react'

export default function FileBreadcrumb({ filePath, s, onBack }) {
  const titleColor = getTitleColor(s)
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
      <span>{formatPath(filePath)}</span>
    </div>
  )
}
