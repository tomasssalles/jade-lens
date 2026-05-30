import { visit, SKIP } from 'unist-util-visit'

// Matches ISO 8601: date-only, naive datetime, UTC, and offset datetimes
const DATE_RE = /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)\b/g

export default function remarkDates() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!DATE_RE.test(node.value)) return
      DATE_RE.lastIndex = 0

      const children = []
      let last = 0
      let m
      while ((m = DATE_RE.exec(node.value)) !== null) {
        if (m.index > last) {
          children.push({ type: 'text', value: node.value.slice(last, m.index) })
        }
        children.push({
          type: 'inlinedate',
          data: { hName: 'inlinedate', hProperties: { iso: m[1] } },
          children: [],
        })
        last = DATE_RE.lastIndex
      }
      if (last < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(last) })
      }

      parent.children.splice(index, 1, ...children)
      return [SKIP, index + children.length]
    })
  }
}
