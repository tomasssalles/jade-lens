# JS conformance runner

Drives the JS mutation pipeline (`web/src/mutation/`) through every fixture in
`conformance/cases/*.json` and checks the result against the contract in
`conformance/README.md`. The JS counterpart to `runners/python/`.

## Run

```sh
node conformance/runners/js/run.mjs        # from the repo root
```

or via the web package (also runs as part of `npm test`):

```sh
cd web && npm run test:conformance
```

Exit code 0 means all cases passed; non-zero prints the failing cases.

## How it works

`run.mjs` seeds an in-memory file map (`Map<path, content>`) from each case's
`before` (plus the `.jade/version` precondition), runs it through
`run()` from `web/src/mutation/index.js`, and compares:

- **success cases** — the resulting file map against `expect.after`, with
  operations-log lines normalised structurally (parsed, `ts` blanked) exactly as
  the Python runner does (README §4);
- **rejection cases** — that a `ConformanceError` with the expected `code` is
  thrown. Atomicity is structural: `run()` works on a clone, so the input map is
  never partially mutated.

No test framework or dependencies — plain Node ESM, importing the pipeline
directly. The pipeline itself is dependency-free.
