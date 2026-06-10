import { describe, it, expect } from 'vitest';
import { buildCheckboxToggle, checkboxCommitMessage } from './checkbox.js';
import { run } from '../mutation/index.js';

const VERSION = 'v0.1.0';

// Apply a derived toggle batch through the real pipeline and return the new file.
function applyToggle(content, line, path = 'todo.md') {
  const batch = buildCheckboxToggle(content, line, path);
  if (!batch) return null;
  const tree = new Map([
    ['.jade/version', VERSION],
    [path, content],
    ['Index.json', `[\n  {\n    "File": "[[${path}]]",\n    "Scope": "user"\n  }\n]\n`],
  ]);
  const out = run(tree, batch.operations, batch.commitMessage, { timestamp: 'T' });
  return out.get(path);
}

describe('buildCheckboxToggle', () => {
  it('checks an unchecked box and round-trips through the pipeline', () => {
    const content = '# Todo\n\n- [ ] buy milk\n- [ ] walk dog\n';
    expect(applyToggle(content, 3)).toBe('# Todo\n\n- [x] buy milk\n- [ ] walk dog\n');
  });

  it('unchecks a checked box', () => {
    const content = '- [x] done thing\n';
    expect(applyToggle(content, 1)).toBe('- [ ] done thing\n');
  });

  it('handles an uppercase [X]', () => {
    const content = '- [X] done\n';
    expect(applyToggle(content, 1)).toBe('- [ ] done\n');
  });

  it('toggles a nested/indented item and preserves indentation + trailing text', () => {
    const content = '- [ ] parent\n  - [ ] child task (urgent)\n';
    expect(applyToggle(content, 2)).toBe('- [ ] parent\n  - [x] child task (urgent)\n');
  });

  it('works with * and + bullets', () => {
    expect(applyToggle('* [ ] star\n', 1)).toBe('* [x] star\n');
    expect(applyToggle('+ [ ] plus\n', 1)).toBe('+ [x] plus\n');
  });

  it('only touches the targeted line', () => {
    const content = '- [ ] a\n- [ ] b\n- [ ] c\n';
    expect(applyToggle(content, 2)).toBe('- [ ] a\n- [x] b\n- [ ] c\n');
  });

  it('returns null for a non-task line', () => {
    expect(buildCheckboxToggle('just text\n', 1, 'x.md')).toBeNull();
    expect(buildCheckboxToggle('- regular bullet\n', 1, 'x.md')).toBeNull();
  });

  it('returns null for an out-of-range line', () => {
    expect(buildCheckboxToggle('- [ ] a\n', 5, 'x.md')).toBeNull();
  });

  it('emits a single unified_diff op with the static commit message', () => {
    const batch = buildCheckboxToggle('- [ ] a\n', 1, 'todo.md');
    expect(batch.operations).toHaveLength(1);
    expect(batch.operations[0].op).toBe('unified_diff');
    expect(batch.operations[0].path).toBe('todo.md');
    expect(batch.commitMessage).toBe(checkboxCommitMessage('todo.md'));
    expect(batch.commitMessage).toBe('Manual edit: toggled checkbox — todo.md');
  });
});
