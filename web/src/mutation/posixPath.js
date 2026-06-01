// POSIX path helpers — faithful ports of the Python stdlib behaviour the
// pipeline relies on (posixpath.normpath, PurePosixPath.suffix / .parts).
//
// The browser pipeline operates on an in-memory file map, so it must reproduce
// the path normalisation the filesystem performs for the Python pipeline
// (e.g. `data_repo / "./notes.md"` resolves to `notes.md`).

/** Port of Python's posixpath.normpath. Collapses `.`/`//`, resolves `..`. */
export function normpath(path) {
  if (path === '') return '.';
  let initialSlashes = path.startsWith('/') ? 1 : 0;
  // POSIX: exactly two leading slashes are special; three or more collapse to one.
  if (initialSlashes && path.startsWith('//') && !path.startsWith('///')) {
    initialSlashes = 2;
  }
  const comps = path.split('/');
  const newComps = [];
  for (const comp of comps) {
    if (comp === '' || comp === '.') continue;
    if (
      comp !== '..' ||
      (!initialSlashes && newComps.length === 0) ||
      (newComps.length && newComps[newComps.length - 1] === '..')
    ) {
      newComps.push(comp);
    } else if (newComps.length) {
      newComps.pop();
    }
  }
  let result = newComps.join('/');
  if (initialSlashes) result = '/'.repeat(initialSlashes) + result;
  return result || '.';
}

/** Port of PurePosixPath(path).suffix — the final component's extension. */
export function suffix(path) {
  const name = path.split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  if (i > 0 && i < name.length - 1) return name.slice(i);
  return '';
}

/**
 * First path component, mirroring PurePosixPath(path).parts[0]: `.` segments
 * are dropped, `..` is kept. Returns undefined for an empty/`.`-only path.
 */
export function firstComponent(path) {
  for (const comp of path.split('/')) {
    if (comp === '' || comp === '.') continue;
    return comp;
  }
  return undefined;
}
