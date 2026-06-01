// Minimal .gitignore matcher for the wikilink scan.
//
// The Python pipeline determines "git-visible files" via `git ls-files
// --exclude-standard`, which honours .gitignore. The browser pipeline has no
// git, so it reproduces that filtering from a `.gitignore` present in the file
// map. In real web-app use the file map comes from the GitHub tree and contains
// only tracked files (ignored files are never present), so this matters chiefly
// for cross-client conformance parity.
//
// NOTE: this is intentionally a *subset* of git's matching — root `.gitignore`
// only (no nested), supports `#` comments, `!` negation, leading-`/` anchoring,
// trailing-`/` directory patterns, and `*` / `**` globs. Sufficient for the
// conformance cases and common patterns; revisit (or swap for a vetted lib) if a
// case needs fuller fidelity.

function globToRegexSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` matches zero or more dirs
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return re;
}

export function makeIgnoreMatcher(gitignoreContent) {
  const patterns = [];
  for (const raw of (gitignoreContent ?? '').split('\n')) {
    let line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    if (line.endsWith('/')) line = line.slice(0, -1); // directory marker; we match names either way
    let anchored = false;
    if (line.startsWith('/')) {
      anchored = true;
      line = line.slice(1);
    }
    if (line === '') continue;
    patterns.push({ pattern: line, negated, anchored });
  }

  function matchOne(p, path) {
    const src = globToRegexSource(p.pattern);
    if (p.anchored || p.pattern.includes('/')) {
      return new RegExp('^' + src + '(/.*)?$').test(path);
    }
    // No slash: match the basename or any path component (git semantics).
    const segRe = new RegExp('^' + src + '$');
    return path.split('/').some((seg) => segRe.test(seg));
  }

  function ignores(path) {
    let ignored = false;
    for (const p of patterns) {
      if (matchOne(p, path)) ignored = !p.negated; // last matching pattern wins
    }
    return ignored;
  }

  return { ignores };
}
