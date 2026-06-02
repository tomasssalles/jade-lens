import { useMemo } from 'react'

// The bot-maintained map of the data (DESIGN.md §4.6). Pinned to the top of
// the tree as a distinct, emphasized entry rather than sorted in alphabetically.
const INDEX_PATH = 'Index.json'

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

function stripExt(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function sorted(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name))
}

function TreeNode({ node, onFileClick, openDirs, onToggle, depth }) {
  const indent = { paddingLeft: `${depth * 1.2 + 0.75}rem` }

  if (node.type === 'blob') {
    return (
      <div className="tree-item tree-file" style={indent} onClick={() => onFileClick(node.fullPath)}>
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
        />
      ))}
    </div>
  )
}

export default function FileTree({ items, onFileClick, openDirs, onToggle }) {
  const tree = useMemo(() => buildTree(items), [items])

  // Pin the root-level index file to the top as a distinct entry; everything
  // else sorts alphabetically below it.
  const indexNode = tree[INDEX_PATH]?.type === 'blob' ? tree[INDEX_PATH] : null
  const rest = sorted(Object.values(tree).filter(n => n !== indexNode))

  return (
    <div className="file-tree">
      {indexNode && (
        <>
          <div
            className="tree-item tree-file tree-index"
            style={{ paddingLeft: '0.75rem' }}
            onClick={() => onFileClick(indexNode.fullPath)}
          >
            <span className="tree-index-icon" aria-hidden="true">🔍</span>
            {stripExt(indexNode.name)}
          </div>
          <div className="tree-index-separator" />
        </>
      )}
      {rest.map(node => (
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
