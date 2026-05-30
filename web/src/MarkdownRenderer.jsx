import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { visit, SKIP } from 'unist-util-visit'
import rehypeHighlight from 'rehype-highlight'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import ini from 'highlight.js/lib/languages/ini'
import 'highlight.js/styles/github.css'
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

const rehypeHighlightOptions = {
  languages: { python, javascript, typescript, json, bash, html: xml, css, sql, yaml, toml: ini },
  ignoreMissing: true,
}
const rehypePlugins = [[rehypeHighlight, rehypeHighlightOptions]]

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
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
