// Error types for the JS mutation pipeline — mirror jadelens/operations.py.
//
// `code` is the cross-client contract (conformance/README.md §5): prose
// messages may be reworded freely, but the code is what the conformance suite
// asserts on.

export class ConformanceError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'ConformanceError';
    this.code = code;
  }
}

export class ValidationError extends ConformanceError {
  constructor(message, code = null) {
    super(message, code);
    this.name = 'ValidationError';
  }
}

export class ApplyError extends ConformanceError {
  constructor(message, code = null) {
    super(message, code);
    this.name = 'ApplyError';
  }
}

export class BatchValidationError extends ConformanceError {
  constructor(message, code = null) {
    super(message, code);
    this.name = 'BatchValidationError';
  }
}
