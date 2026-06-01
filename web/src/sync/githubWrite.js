// GitHub Git Data API write path — the web app's commit substrate (Phase 1 of
// docs/mutation-sync-implementation-plan.md; see docs/sync-and-conflicts.md §1).
//
// The browser has no local git, so a "commit" is built via the Git Data API:
//   create tree (on base_tree, inline blob content) → create commit (parent =
//   base SHA) → update ref (PATCH, non-force).
// Only the final ref update mutates remote state; a failure earlier leaves
// unreferenced objects that GitHub GCs (nothing to roll back). A non-fast-forward
// ref update (remote advanced under us) surfaces as PushConflictError — the
// conflict signal the sync/stash layer acts on.

import { parseRepoUrl } from '../github.js';

const GIT_FILE_MODE = '100644'; // regular, non-executable file

/** Remote moved under us — the push is not a fast-forward (the conflict signal). */
export class PushConflictError extends Error {
  constructor(message = 'Push rejected: remote has advanced (non-fast-forward)') {
    super(message);
    this.name = 'PushConflictError';
  }
}

/** Any other GitHub write failure; `status` carries the HTTP code (401/403/404/…). */
export class GitHubWriteError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubWriteError';
    this.status = status;
  }
}

async function api(path, pat, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(res, context) {
  if (!res.ok) {
    throw new GitHubWriteError(`${context}: GitHub returned ${res.status}`, res.status);
  }
  return res.json();
}

function ownerRepo(repoUrl) {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new GitHubWriteError('Could not parse repo URL', 0);
  return parsed;
}

/**
 * Resolve the current head of `branch` (default branch if omitted).
 * @returns {{branch: string, commitSha: string, treeSha: string}}
 */
export async function getBranchHead(repoUrl, pat, branch) {
  const { owner, repo } = ownerRepo(repoUrl);

  let resolvedBranch = branch;
  if (!resolvedBranch) {
    const repoInfo = await readJson(await api(`/repos/${owner}/${repo}`, pat), 'get repo');
    resolvedBranch = repoInfo.default_branch;
  }

  const ref = await readJson(
    await api(`/repos/${owner}/${repo}/git/ref/heads/${resolvedBranch}`, pat),
    'get ref',
  );
  const commitSha = ref.object.sha;

  const commit = await readJson(
    await api(`/repos/${owner}/${repo}/git/commits/${commitSha}`, pat),
    'get commit',
  );
  return { branch: resolvedBranch, commitSha, treeSha: commit.tree.sha };
}

/**
 * Diff two file maps into the minimal set of changes for a Git tree.
 * Added/modified files carry `content`; deleted files carry `sha: null`
 * (which, combined with `base_tree`, removes the path). Pure — no I/O.
 *
 * @param {Map<string,string>} baseMap - last-synced content
 * @param {Map<string,string>} newMap - desired content
 * @returns {Array<{path:string, mode:string, type:'blob', content?:string, sha?:null}>}
 */
export function computeTreeChanges(baseMap, newMap) {
  const entries = [];
  for (const [path, content] of newMap) {
    if (!baseMap.has(path) || baseMap.get(path) !== content) {
      entries.push({ path, mode: GIT_FILE_MODE, type: 'blob', content });
    }
  }
  for (const path of baseMap.keys()) {
    if (!newMap.has(path)) {
      entries.push({ path, mode: GIT_FILE_MODE, type: 'blob', sha: null });
    }
  }
  return entries;
}

/**
 * Commit the difference between `baseMap` and `newMap` onto `branch`.
 *
 * @returns {{commitSha: string, treeSha?: string, changed: boolean}}
 * @throws {PushConflictError} if the ref update is not a fast-forward (remote advanced).
 * @throws {GitHubWriteError} on any other GitHub failure (status carried).
 */
export async function commitFileMap(
  repoUrl,
  pat,
  { branch, baseCommitSha, baseTreeSha, baseMap, newMap, message },
) {
  const { owner, repo } = ownerRepo(repoUrl);

  const changes = computeTreeChanges(baseMap, newMap);
  if (changes.length === 0) {
    return { commitSha: baseCommitSha, changed: false };
  }

  const tree = await readJson(
    await api(`/repos/${owner}/${repo}/git/trees`, pat, {
      method: 'POST',
      body: { base_tree: baseTreeSha, tree: changes },
    }),
    'create tree',
  );

  const commit = await readJson(
    await api(`/repos/${owner}/${repo}/git/commits`, pat, {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [baseCommitSha] },
    }),
    'create commit',
  );

  const refRes = await api(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, pat, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });
  // 422 Unprocessable Entity is GitHub's "Update is not a fast forward".
  if (refRes.status === 422) {
    throw new PushConflictError();
  }
  if (!refRes.ok) {
    throw new GitHubWriteError(`update ref: GitHub returned ${refRes.status}`, refRes.status);
  }

  return { commitSha: commit.sha, treeSha: tree.sha, changed: true };
}
