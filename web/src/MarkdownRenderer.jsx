import { useContext, useMemo, useRef } from 'react'
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
import { CheckboxToggleContext, ListItemLineContext } from './edit/checkboxContext'
import './markdown.css'

// How long a touch must be held to count as a long-press (ms).
const LONG_PRESS_MS = 500

// A task-list checkbox. Interactive when a toggle handler is in context and the
// enclosing list item's source line is known; otherwise read-only (as before).
//
// Reading is the common case, so a single tap/click must NOT toggle — only a
// deliberate gesture commits: double-click on desktop, long-press on touch
// (docs/web/editing.md "Entering an edit"). Native single-click toggling, the
// long-press context menu, and text selection are all suppressed.
function TaskCheckbox({ checked }) {
  const onToggle = useContext(CheckboxToggleContext)
  const line = useContext(ListItemLineContext)
  const timerRef = useRef(null)

  if (!(onToggle && line != null)) {
    return <input type="checkbox" checked={!!checked} readOnly disabled className="jl-checkbox" />
  }

  const fire = () => onToggle(line, !!checked)
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const onTouchStart = () => {
    clearTimer()
    timerRef.current = setTimeout(() => { timerRef.current = null; fire() }, LONG_PRESS_MS)
  }

  return (
    <input
      type="checkbox"
      checked={!!checked}
      readOnly
      className="jl-checkbox jl-checkbox-editable"
      onClick={(e) => e.preventDefault()}      // a single click never toggles
      onDoubleClick={fire}                     // desktop gesture
      onContextMenu={(e) => e.preventDefault()} // suppress the long-press menu
      onTouchStart={onTouchStart}              // start the long-press timer
      onTouchEnd={clearTimer}
      onTouchMove={clearTimer}                 // a scroll/drag cancels it
      onTouchCancel={clearTimer}
    />
  )
}

// A markdown list item that publishes its source line to descendants, so a task
// checkbox inside it can map back to the source for an in-place toggle.
function ListItem({ node, children, ...props }) {
  const line = node?.position?.start?.line ?? null
  return (
    <ListItemLineContext.Provider value={line}>
      <li {...props}>{children}</li>
    </ListItemLineContext.Provider>
  )
}

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

// inline=true: suppresses paragraph margins for card viewer string values.
// onCheckboxToggle(line, checked): enables in-place task-checkbox toggling.
export default function MarkdownRenderer({ content, onWikilinkClick, onCheckboxToggle = null, inline = false }) {
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
    li: ListItem,
    input: ({ type, checked }) => {
      if (type === 'checkbox') return <TaskCheckbox checked={checked} />
      return <input type={type} />
    },
  }), [onWikilinkClick])

  return (
    <CheckboxToggleContext.Provider value={onCheckboxToggle}>
      <div className={`jl-markdown${inline ? ' jl-inline-markdown' : ''}`}>
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </CheckboxToggleContext.Provider>
  )
}
