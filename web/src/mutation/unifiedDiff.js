// Parsing and application of 0-context unified diffs — a faithful port of
// jadelens/unified_diff.py. Strict, predictable semantics (no fuzz, no line
// drift): all hunks reference the original file's line numbers, removed lines
// must match byte-for-byte, hunks are canonicalised and checked for non-overlap.

export class DiffParseError extends Error {}
export class DiffApplyError extends Error {}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/** Mirror Python str.splitlines(keepends=True) for `\n`-terminated text. */
function splitlinesKeepends(s) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      lines.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

function stripTrailingNewline(line) {
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

export function parseUnifiedDiff(diffText) {
  const lines = diffText.split('\n');
  // A trailing `\n` yields a final empty element from split; drop it.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const hunks = [];
  let i = 0;
  // Skip any preamble (file headers, etc.) until the first hunk header.
  while (i < lines.length && !lines[i].startsWith('@@')) i++;

  while (i < lines.length) {
    const m = HUNK_HEADER_RE.exec(lines[i]);
    if (!m) throw new DiffParseError(`Malformed hunk header: ${JSON.stringify(lines[i])}`);
    const oldStart = parseInt(m[1], 10);
    const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    const newCount = m[3] !== undefined ? parseInt(m[3], 10) : 1;
    i++;

    const removed = [];
    const added = [];
    while (i < lines.length && !lines[i].startsWith('@@')) {
      const line = lines[i];
      if (line.startsWith('-')) removed.push(line.slice(1));
      else if (line.startsWith('+')) added.push(line.slice(1));
      else if (line.startsWith(' ')) {
        throw new DiffParseError(
          `Context lines are not supported (0-context format required): ${JSON.stringify(line)}`,
        );
      } else {
        throw new DiffParseError(`Unexpected line in hunk body: ${JSON.stringify(line)}`);
      }
      i++;
    }

    if (removed.length !== oldCount) {
      throw new DiffParseError(
        `Hunk header declared ${oldCount} removed line(s) but hunk body has ${removed.length}`,
      );
    }
    if (added.length !== newCount) {
      throw new DiffParseError(
        `Hunk header declared ${newCount} added line(s) but hunk body has ${added.length}`,
      );
    }

    hunks.push({ oldStart, oldCount, removed, added });
  }

  // Canonicalise: sort by (oldStart, addressing-before-pure-insert), then
  // verify strict ordering / non-overlap (JS Array.sort is stable).
  hunks.sort(
    (a, b) => a.oldStart - b.oldStart || (a.oldCount > 0 ? 0 : 1) - (b.oldCount > 0 ? 0 : 1),
  );
  verifyOrderingAndNonOverlap(hunks);
  return hunks;
}

function verifyOrderingAndNonOverlap(hunks) {
  for (let i = 0; i < hunks.length - 1; i++) {
    const a = hunks[i];
    const b = hunks[i + 1];
    let minBStart;
    if (a.oldCount === 0) {
      minBStart = a.oldStart + 1; // A pure insert; B must start strictly after.
    } else if (b.oldCount === 0) {
      minBStart = a.oldStart + a.oldCount - 1; // insert at the boundary after A is OK.
    } else {
      minBStart = a.oldStart + a.oldCount; // both addressing: B after A's range.
    }
    if (b.oldStart < minBStart) {
      throw new DiffParseError(
        `Hunks out of order or overlapping: previous hunk @@ -${a.oldStart},${a.oldCount} ... @@ ` +
          `is followed by hunk @@ -${b.oldStart},${b.oldCount} ... @@ ` +
          `(B.old_start must be >= ${minBStart})`,
      );
    }
  }
}

export function applyUnifiedDiff(original, diffText) {
  const hunks = parseUnifiedDiff(diffText);
  const originalLines = splitlinesKeepends(original);

  const newLines = [];
  let cursor = 0; // 0-indexed position in originalLines

  for (const hunk of hunks) {
    const insertAt = hunk.oldCount > 0 ? hunk.oldStart - 1 : hunk.oldStart;

    // Copy untouched lines from cursor up to the hunk's position.
    newLines.push(...originalLines.slice(cursor, insertAt));

    // Verify removed lines match file content at the claimed position.
    for (let offset = 0; offset < hunk.removed.length; offset++) {
      const idx = insertAt + offset;
      if (idx >= originalLines.length) {
        throw new DiffApplyError(
          `Hunk references line ${idx + 1} but file only has ${originalLines.length} line(s)`,
        );
      }
      const actual = stripTrailingNewline(originalLines[idx]);
      if (actual !== hunk.removed[offset]) {
        throw new DiffApplyError(
          `Line ${idx + 1} mismatch: file has ${JSON.stringify(actual)}, ` +
            `hunk expected ${JSON.stringify(hunk.removed[offset])}`,
        );
      }
    }

    // Emit added lines, each with a trailing newline.
    for (const addedLine of hunk.added) newLines.push(addedLine + '\n');

    cursor = insertAt + hunk.oldCount;
  }

  newLines.push(...originalLines.slice(cursor));
  return newLines.join('');
}
