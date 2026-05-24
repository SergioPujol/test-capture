import { captureError, errorNames } from "./errors.mjs";

export const states = {
  CREATED: "CREATED",
  RECORDING: "RECORDING",
  CAPTURED: "CAPTURED",
  SCENARIO_DRAFTED: "SCENARIO_DRAFTED",
  SCENARIO_APPROVED: "SCENARIO_APPROVED",
  COVERAGE_PLANNED: "COVERAGE_PLANNED",
  COVERAGE_APPROVED: "COVERAGE_APPROVED",
  TEST_GENERATED: "TEST_GENERATED",
  VERIFIED: "VERIFIED",
  TRIAGE_NEEDED: "TRIAGE_NEEDED",
};

const transitions = new Map([
  [states.CREATED, new Set([states.RECORDING])],
  [states.RECORDING, new Set([states.CAPTURED])],
  [states.CAPTURED, new Set([states.SCENARIO_DRAFTED])],
  [states.SCENARIO_DRAFTED, new Set([states.SCENARIO_APPROVED])],
  [states.SCENARIO_APPROVED, new Set([states.COVERAGE_PLANNED])],
  [states.COVERAGE_PLANNED, new Set([states.COVERAGE_APPROVED])],
  [states.COVERAGE_APPROVED, new Set([states.TEST_GENERATED])],
  [states.TEST_GENERATED, new Set([states.VERIFIED, states.TRIAGE_NEEDED])],
  [states.TRIAGE_NEEDED, new Set([states.TEST_GENERATED])],
]);

export function assertTransition(from, to, sessionId) {
  if (!transitions.get(from)?.has(to)) {
    throw captureError(
      errorNames.InvalidSessionTransitionError,
      `Cannot transition session from ${from} to ${to}.`,
      {
        sessionId,
        operation: "advance_session_state",
        nextSafeAction: "Inspect the session state and complete the required prior step.",
      },
    );
  }
}
