import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { visit, SKIP } from 'unist-util-visit'
import remarkWikilinks from './plugins/remarkWikilinks'
import remarkDates from './plugins/remarkDates'
import WikilinkNode from './nodes/WikilinkNode'
import DateNode from './nodes/DateNode'
import './markdown.css'

// Strip raw HTML nodes (<!-- comments -->, inline tags) before remark-rehype
// sees them — react-markdown leaks their source text without rehype-raw.
function remarkStripHtml() {
  return (tree) => {
    visit(tree, 'html', (_, index, parent) => {
      parent.children.splice(index, 1)
      return [SKIP, index]
    })
  }
}

const remarkPlugins = [remarkGfm, remarkWikilinks, remarkDates, remarkStripHtml]

// inline=true: suppresses paragraph margins for card viewer string values
export default function MarkdownRenderer({ content, onWikilinkClick, inline = false }) {
  const components = useMemo(() => ({
    wikilink: ({ path }) => (
      <WikilinkNode path={path} onWikilinkClick={onWikilinkClick} />
    ),
    inlinedate: ({ iso }) => <DateNode iso={iso} />,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="jl-url">
        {children}
      </a>
    ),
    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        return <input type="checkbox" checked={checked} readOnly disabled className="jl-checkbox" />
      }
      return <input type={type} />
    },
  }), [onWikilinkClick])

  return (
    <div className={`jl-markdown${inline ? ' jl-inline-markdown' : ''}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
