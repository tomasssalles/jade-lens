// Validates the source-line mapping the checkbox toggle relies on: that the
// hast `<li>` node MarkdownRenderer's ListItem reads (`node.position.start.line`)
// matches the source line of each task-list checkbox — across the same remark
// pipeline react-markdown runs (remark-parse → remark-gfm → remark-rehype).
import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import { buildCheckboxToggle } from './checkbox.js';

function taskListItemLines(md) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const hast = processor.runSync(processor.parse(md));
  const lines = [];
  visit(hast, 'element', (node) => {
    if (node.tagName !== 'li') return;
    const cls = node.properties?.className;
    const classes = Array.isArray(cls) ? cls : cls ? [cls] : [];
    if (classes.includes('task-list-item')) lines.push(node.position?.start?.line);
  });
  return lines;
}

describe('task-list source-line mapping', () => {
  const md = '# Todo\n\n- [ ] first\n- [x] second\n  - [ ] nested\n';

  it('maps each task item li to its checkbox source line in document order', () => {
    expect(taskListItemLines(md)).toEqual([3, 4, 5]);
  });

  it('those lines drive the correct toggle', () => {
    const lines = taskListItemLines(md);
    // Toggling the 2nd task item (line 4) flips "second" from [x] to [ ].
    const batch = buildCheckboxToggle(md, lines[1], 'todo.md');
    expect(batch.operations[0].diff).toContain('-- [x] second');
    expect(batch.operations[0].diff).toContain('+- [ ] second');
    // Toggling the nested item (line 5) flips "nested".
    const nested = buildCheckboxToggle(md, lines[2], 'todo.md');
    expect(nested.operations[0].diff).toContain('+  - [x] nested');
  });
});
