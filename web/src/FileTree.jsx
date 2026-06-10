import { useMemo, useRef, useState } from 'react'

function buildTree(flatItems) {
  const root = {}
  for (const item of flatItems) {
    if (item.type !== 'blob' && item.type !== 'tree') continue
    const parts = item.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!node[part]) {
        node[part] = {
          name: part,
          fullPath: parts.slice(0, i + 1).join('/'),
          type: i === parts.length - 1 ? item.type : 'tree',
          scope: i === parts.length - 1 ? (item.scope ?? null) : null,
          children: {},
        }
      }
      node = node[part].children
    }
  }
  return root
}

function stripExt(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function sorted(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name))
}

function TreeNode({ node, onFileClick, openDirs, onToggle, depth, onTooltip, onSheet }) {
  const indent = { paddingLeft: `${depth * 1.2 + 0.75}rem` }
  const timerRef = useRef(null)
  const longPressRef = useRef(false)

  if (node.type === 'blob') {
    const handleClick = () => {
      if (!longPressRef.current) onFileClick(node.fullPath)
      longPressRef.current = false
    }
    const handleMouseEnter = (e) => {
      if (!node.scope) return
      const rect = e.currentTarget.getBoundingClientRect()
      onTooltip({ text: node.scope, top: rect.top, left: rect.right + 8 })
    }
    const handleMouseLeave = () => onTooltip(null)
    const handleTouchStart = () => {
      longPressRef.current = false
      if (!node.scope) return
      timerRef.current = setTimeout(() => {
        longPressRef.current = true
        onSheet({ name: stripExt(node.name), text: node.scope })
      }, 500)
    }
    const handleTouchEnd = () => clearTimeout(timerRef.current)
    const handleTouchMove = () => {
      clearTimeout(timerRef.current)
      longPressRef.current = false
    }

    return (
      <div
        className="tree-item tree-file"
        style={indent}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {stripExt(node.name)}
      </div>
    )
  }

  const open = openDirs.has(node.fullPath)
  const children = sorted(Object.values(node.children))
  return (
    <div>
      <div className="tree-item tree-dir" style={indent} onClick={() => onToggle(node.fullPath)}>
        <span className="tree-chevron">{open ? '▼' : '▶'}</span>
        {node.name}
      </div>
      {open && children.map(child => (
        <TreeNode
          key={child.fullPath}
          node={child}
          onFileClick={onFileClick}
          openDirs={openDirs}
          onToggle={onToggle}
          depth={depth + 1}
          onTooltip={onTooltip}
          onSheet={onSheet}
        />
      ))}
    </div>
  )
}

export default function FileTree({ items, onFileClick, openDirs, onToggle }) {
  const tree = useMemo(() => buildTree(items), [items])
  const nodes = sorted(Object.values(tree))
  const [tooltip, setTooltip] = useState(null)
  const [sheet, setSheet] = useState(null)

  return (
    <div className="file-tree">
      {nodes.map(node => (
        <TreeNode
          key={node.fullPath}
          node={node}
          onFileClick={onFileClick}
          openDirs={openDirs}
          onToggle={onToggle}
          depth={0}
          onTooltip={setTooltip}
          onSheet={setSheet}
        />
      ))}
      {tooltip && (
        <div className="scope-tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
          {tooltip.text}
        </div>
      )}
      {sheet && (
        <div className="scope-sheet-overlay" onClick={() => setSheet(null)}>
          <div className="scope-sheet" onClick={e => e.stopPropagation()}>
            <div className="scope-sheet-name">{sheet.name}</div>
            <p className="scope-sheet-text">{sheet.text}</p>
          </div>
        </div>
      )}
    </div>
  )
}
