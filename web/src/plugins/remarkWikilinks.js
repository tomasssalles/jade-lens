import { visit, SKIP } from 'unist-util-visit'

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

export default function remarkWikilinks() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!WIKILINK_RE.test(node.value)) return
      WIKILINK_RE.lastIndex = 0

      const children = []
      let last = 0
      let m
      while ((m = WIKILINK_RE.exec(node.value)) !== null) {
        if (m.index > last) {
          children.push({ type: 'text', value: node.value.slice(last, m.index) })
        }
        children.push({
          type: 'wikilink',
          data: { hName: 'wikilink', hProperties: { path: m[1] } },
          children: [],
        })
        last = WIKILINK_RE.lastIndex
      }
      if (last < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(last) })
      }

      parent.children.splice(index, 1, ...children)
      return [SKIP, index + children.length]
    })
  }
}
