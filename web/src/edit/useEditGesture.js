import { useRef } from 'react';

// The deliberate "enter edit" gesture for the markdown checkbox — the one
// in-place edit that lives directly in read mode, outside the JSON card view's
// edit-mode lock (docs/web/editing.md "Entering an edit"): long-press on touch,
// double-click on desktop. A single tap/click never edits — reading is the common
// case. The long-press context menu is suppressed. Pass `preventClick: true` for
// elements (like a checkbox) whose native single-click would otherwise act.

export const LONG_PRESS_MS = 500;

/**
 * @param {() => void} onEdit - invoked when the edit gesture completes.
 * @param {{preventClick?: boolean, longPressMs?: number}} [opts]
 * @returns {object} event-handler props to spread onto the editable element.
 */
export function useEditGesture(onEdit, { preventClick = false, longPressMs = LONG_PRESS_MS } = {}) {
  const timerRef = useRef(null);
  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const handlers = {
    onDoubleClick: () => onEdit(),
    onContextMenu: (e) => e.preventDefault(), // suppress the long-press menu
    onTouchStart: () => {
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onEdit();
      }, longPressMs);
    },
    onTouchEnd: clear,
    onTouchMove: clear, // a scroll/drag cancels the long-press
    onTouchCancel: clear,
  };
  if (preventClick) handlers.onClick = (e) => e.preventDefault();
  return handlers;
}
