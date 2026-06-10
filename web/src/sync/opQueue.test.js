import { describe, it, expect, vi } from "vitest";
import { OpQueue } from "./opQueue.js";
import { createMemoryQueueStore } from "./queueStore.js";
import { PushConflictError, GitHubWriteError } from "./githubWrite.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const VERSION = "v1";
const LOG_PATH = `.jade/operations-log/${VERSION}.jsonl`;

// A minimal synced baseline: the version file is required by the pipeline (the
// ops-log path is derived from it).
function baseMap(extra = {}) {
  return new Map([[".jade/version", VERSION], ...Object.entries(extra)]);
}

async function freshQueue(base = baseMap()) {
  const q = new OpQueue(createMemoryQueueStore());
  await q.init({
    repoUrl: "https://github.com/o/r",
    branch: "main",
    baseCommitSha: "base000",
    baseTreeSha: "tree000",
    baseMap: base,
  });
  return q;
}

// A create_file batch for one path, with a fixed timestamp for determinism.
function createBatch(path, content, ts) {
  return {
    operations: [{ op: "create_file", path, content, indexed: true, scope: "user" }],
    commitMessage: `add ${path}`,
    timestamp: ts,
  };
}

// A commit() stub that always succeeds, recording every call and minting SHAs.
function recordingCommit() {
  const calls = [];
  let n = 0;
  const commit = vi.fn(async (repoUrl, pat, args) => {
    calls.push({ repoUrl, pat, args });
    n += 1;
    return { commitSha: `commit${n}`, treeSha: `tree${n}`, changed: true };
  });
  return { commit, calls };
}

// ── enqueue ──────────────────────────────────────────────────────────────────

describe("OpQueue.enqueue", () => {
  it("applies the batch locally and appends it to the queue", async () => {
    const q = await freshQueue();
    const working = await q.enqueue(
      createBatch("notes.md", "hello\n", "2026-06-01T00:00:00.000Z"),
    );

    expect(working.get("notes.md")).toBe("hello\n");
    const state = await q.getState();
    expect(state.queue).toHaveLength(1);
    expect(state.workingMap.get("notes.md")).toBe("hello\n");
    // base is untouched until a push.
    expect(state.baseCommitSha).toBe("base000");
    expect(state.baseMap.has("notes.md")).toBe(false);
  });

  it("writes one ops-log line per enqueued batch, with the frozen timestamp", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    await q.enqueue(createBatch("b.md", "B\n", "2026-06-01T00:00:01.000Z"));

    const state = await q.getState();
    const lines = state.workingMap.get(LOG_PATH).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).ts).toBe("2026-06-01T00:00:00.000Z");
    expect(JSON.parse(lines[1]).commit_message).toBe("add b.md");
  });

  it("rejects an invalid batch and leaves state untouched (atomic)", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("ok.md", "ok\n", "2026-06-01T00:00:00.000Z"));
    const before = await q.getState();

    await expect(
      // create_file into a protected path → ValidationError from the pipeline.
      q.enqueue(
        createBatch(".jade/secret.md", "x\n", "2026-06-01T00:00:02.000Z"),
      ),
    ).rejects.toThrow();

    const after = await q.getState();
    expect(after.queue).toHaveLength(before.queue.length);
    expect(after.workingMap.has(".jade/secret.md")).toBe(false);
  });

  it("throws if called before init", async () => {
    const q = new OpQueue(createMemoryQueueStore());
    await expect(q.enqueue(createBatch("x.md", "x\n", "t"))).rejects.toThrow(
      /init/,
    );
  });
});

// ── push ─────────────────────────────────────────────────────────────────────

describe("OpQueue.push", () => {
  it("pushes each queued batch as its own commit, in order, advancing the base", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    await q.enqueue(createBatch("b.md", "B\n", "2026-06-01T00:00:01.000Z"));
    const { commit, calls } = recordingCommit();

    const res = await q.push({ pat: "tok", commit });

    expect(res).toEqual({ pushed: 2, conflicted: false });
    expect(calls).toHaveLength(2);
    // first commit is parented on the original base; second on the first's result.
    expect(calls[0].args.baseCommitSha).toBe("base000");
    expect(calls[0].args.baseTreeSha).toBe("tree000");
    expect(calls[1].args.baseCommitSha).toBe("commit1");
    expect(calls[1].args.baseTreeSha).toBe("tree1");

    const state = await q.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.baseCommitSha).toBe("commit2");
    expect(state.baseTreeSha).toBe("tree2");
    // base now equals the working content.
    expect(state.baseMap.get("a.md")).toBe("A\n");
    expect(state.baseMap.get("b.md")).toBe("B\n");
  });

  it("replays each batch incrementally — the final pushed map equals working content", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    await q.enqueue(createBatch("b.md", "B\n", "2026-06-01T00:00:01.000Z"));
    const working = (await q.getState()).workingMap;
    const { commit, calls } = recordingCommit();

    await q.push({ pat: "tok", commit });

    const lastPushedMap = calls[1].args.newMap;
    expect(lastPushedMap).toEqual(working);
    // the second commit's diff base is the first batch's result, so it carries
    // a's content plus b's — i.e. the cumulative state.
    expect(lastPushedMap.get("a.md")).toBe("A\n");
    expect(lastPushedMap.get("b.md")).toBe("B\n");
    expect(lastPushedMap.get(LOG_PATH).trimEnd().split("\n")).toHaveLength(2);
  });

  it("each commit carries only its own incremental log line in the base→new diff", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    await q.enqueue(createBatch("b.md", "B\n", "2026-06-01T00:00:01.000Z"));
    const { commit, calls } = recordingCommit();

    await q.push({ pat: "tok", commit });

    // First push: base has no log; newMap has one line.
    expect(calls[0].args.baseMap.has(LOG_PATH)).toBe(false);
    expect(
      calls[0].args.newMap.get(LOG_PATH).trimEnd().split("\n"),
    ).toHaveLength(1);
    // Second push: base has one line (the advanced base); newMap has two.
    expect(
      calls[1].args.baseMap.get(LOG_PATH).trimEnd().split("\n"),
    ).toHaveLength(1);
    expect(
      calls[1].args.newMap.get(LOG_PATH).trimEnd().split("\n"),
    ).toHaveLength(2);
  });

  it("stops at the first conflict, keeping the unpushed batches and the advanced base", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    await q.enqueue(createBatch("b.md", "B\n", "2026-06-01T00:00:01.000Z"));
    await q.enqueue(createBatch("c.md", "C\n", "2026-06-01T00:00:02.000Z"));

    let n = 0;
    const commit = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new PushConflictError();
      return { commitSha: `commit${n}`, treeSha: `tree${n}`, changed: true };
    });

    const res = await q.push({ pat: "tok", commit });

    expect(res).toEqual({ pushed: 1, conflicted: true });
    const state = await q.getState();
    // batch 1 pushed (base advanced); batches 2 and 3 remain queued in order.
    expect(state.baseCommitSha).toBe("commit1");
    expect(state.queue.map((b) => b.operations[0].path)).toEqual([
      "b.md",
      "c.md",
    ]);
  });

  it("propagates non-conflict write errors, leaving the base at the last success", async () => {
    const q = await freshQueue();
    await q.enqueue(createBatch("a.md", "A\n", "2026-06-01T00:00:00.000Z"));
    const commit = vi.fn(async () => {
      throw new GitHubWriteError("boom", 500);
    });

    await expect(q.push({ pat: "tok", commit })).rejects.toThrow(
      GitHubWriteError,
    );
    const state = await q.getState();
    expect(state.baseCommitSha).toBe("base000");
    expect(state.queue).toHaveLength(1);
  });

  it("is a no-op on an empty queue", async () => {
    const q = await freshQueue();
    const commit = vi.fn();
    const res = await q.push({ pat: "tok", commit });
    expect(res).toEqual({ pushed: 0, conflicted: false });
    expect(commit).not.toHaveBeenCalled();
  });
});
