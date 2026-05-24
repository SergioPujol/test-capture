export class TestCaptureError extends Error {
  constructor(name, message, details = {}) {
    super(message);
    this.name = name;
    this.details = details;
  }

  toResponse() {
    return {
      error: this.name,
      message: this.message,
      nextSafeAction: this.details.nextSafeAction,
      sessionId: this.details.sessionId,
      operation: this.details.operation,
    };
  }
}

export const errorNames = {
  InvalidTargetUrlError: "InvalidTargetUrlError",
  BrowserLaunchError: "BrowserLaunchError",
  TargetUnreachableError: "TargetUnreachableError",
  BrowserDisconnectedError: "BrowserDisconnectedError",
  ArtifactWriteError: "ArtifactWriteError",
  RedactionFailedError: "RedactionFailedError",
  SessionArtifactNotFoundError: "SessionArtifactNotFoundError",
  InvalidSessionTransitionError: "InvalidSessionTransitionError",
  TestOutputParseError: "TestOutputParseError",
  LedgerConsistencyError: "LedgerConsistencyError",
};

export function captureError(name, message, details = {}) {
  return new TestCaptureError(name, message, details);
}
