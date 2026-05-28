import { useMemo } from 'react'

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
          children: {},
        }
      }
      node = node[part].children
    }
  }
  return root
}

function sorted(entries) {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function TreeNode({ node, onFileClick, openDirs, onToggle, depth }) {
  const indent = { paddingLeft: `${depth * 1.2 + 0.75}rem` }

  if (node.type === 'blob') {
    return (
      <div className="tree-item tree-file" style={indent} onClick={() => onFileClick(node.fullPath)}>
        {node.name}
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
        />
      ))}
    </div>
  )
}

export default function FileTree({ items, onFileClick, openDirs, onToggle }) {
  const tree = useMemo(() => buildTree(items), [items])
  const entries = sorted(Object.values(tree))

  return (
    <div className="file-tree">
      {entries.map(node => (
        <TreeNode
          key={node.fullPath}
          node={node}
          onFileClick={onFileClick}
          openDirs={openDirs}
          onToggle={onToggle}
          depth={0}
        />
      ))}
    </div>
  )
}
