import { createContext } from 'react'

// Handler for toggling a rendered task-list checkbox: onToggle(line, checked),
// where `line` is the 1-based source line and `checked` is its current state.
// null when checkboxes should stay read-only (e.g. inline card-viewer strings).
export const CheckboxToggleContext = createContext(null)

// The 1-based source line of the enclosing markdown list item, threaded from the
// mdast node position down to the checkbox input via the rendered `<li>`.
export const ListItemLineContext = createContext(null)
