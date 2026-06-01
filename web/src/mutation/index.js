// Public entry point for the JS mutation pipeline — the shared core that the
// web app's sync layer and the conformance JS runner both consume.
//
// This is the substrate-agnostic pipeline (operates on a Map<path, content>);
// git / GitHub-API / IndexedDB concerns live in the per-client sync layer.
// Byte-identical to the Python pipeline by contract (conformance/README.md).

export { run, validateBatch, mergeUnifiedDiffs } from './workflow.js';
export { parseOperation } from './operations.js';
export {
  ConformanceError,
  ValidationError,
  ApplyError,
  BatchValidationError,
} from './errors.js';
