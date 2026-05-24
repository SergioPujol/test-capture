import { states } from "./states.mjs";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import {
  latestRecordingSession,
  readCaptureBuffer,
  readIndex,
  readSession,
  updateState,
  writeIndex,
  writeTextArtifact,
} from "./session-store.mjs";
import { draftAgentContext, draftCoveragePlan, draftScenario, draftTestability } from "./artifacts.mjs";
import { upsertLedgerEntry } from "./ledger.mjs";
import { triageFailure } from "./triage.mjs";
import { captureError, errorNames } from "./errors.mjs";

const stateOrder = [
  states.CREATED,
  states.RECORDING,
  states.CAPTURED,
  states.SCENARIO_DRAFTED,
  states.SCENARIO_APPROVED,
  states.COVERAGE_PLANNED,
  states.COVERAGE_APPROVED,
  states.TEST_GENERATED,
  states.TRIAGE_NEEDED,
  states.VERIFIED,
];

function atLeast(state, minimum) {
  return stateOrder.indexOf(state) >= stateOrder.indexOf(minimum);
}

function assertHasEvidence(index, sessionId) {
  if (index.events.length === 0 && index.network.length === 0 && index.console.length === 0 && index.screenshots.length === 0) {
    throw captureError(errorNames.InvalidSessionTransitionError, "Cannot summarize or plan coverage for an empty capture session.", {
      sessionId,
      operation: "summarize_session",
      nextSafeAction: "Run a browser capture with at least one observed navigation, interaction, network event, console event, or screenshot.",
    });
  }
}

export function finalizeCapture(sessionId, cwd = process.cwd()) {
  const session = sessionId ? readSession(sessionId, cwd) : latestRecordingSession(cwd);
  if (!session) return null;
  const captured = session.state === states.RECORDING
    ? updateState(session.id, states.CAPTURED, cwd)
    : session;
  const capture = readCaptureBuffer(captured.id, cwd);
  const index = writeIndex(captured, capture, cwd);
  writeTextArtifact(captured.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(captured.id, "agent-context.md", draftAgentContext(captured, index), cwd);
  return captured;
}

export function generateScenario(sessionId, cwd = process.cwd()) {
  let session = readSession(sessionId, cwd);
  if (session.state === states.RECORDING) session = finalizeCapture(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  if (session.state === states.CAPTURED) session = updateState(session.id, states.SCENARIO_DRAFTED, cwd);
  const content = draftScenario(session, index);
  writeTextArtifact(session.id, "scenario.md", content, cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session: readSession(session.id, cwd), content };
}

export function approveScenario(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  return updateState(session.id, states.SCENARIO_APPROVED, cwd);
}

export function generateCoveragePlan(sessionId, cwd = process.cwd()) {
  let session = readSession(sessionId, cwd);
  if (session.state === states.CAPTURED) {
    generateScenario(session.id, cwd);
    session = readSession(session.id, cwd);
  }
  if (session.state === states.SCENARIO_DRAFTED) {
    throw new Error(`Scenario must be approved before coverage planning. Run: test-capture approve-scenario ${session.id}`);
  }
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  if (session.state === states.SCENARIO_APPROVED) session = updateState(session.id, states.COVERAGE_PLANNED, cwd);
  const content = draftCoveragePlan(session, index);
  writeTextArtifact(session.id, "coverage-plan.md", content, cwd);
  writeTextArtifact(session.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session: readSession(session.id, cwd), content };
}

export function approveCoveragePlan(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  return updateState(session.id, states.COVERAGE_APPROVED, cwd);
}

export function linkGeneratedTest({ sessionId, file, command, status = "passing", cwd = process.cwd() }) {
  let session = readSession(sessionId, cwd);
  if (!atLeast(session.state, states.COVERAGE_APPROVED)) {
    throw new Error(`Coverage plan must be approved before linking generated tests. Run: test-capture approve-coverage-plan ${session.id}`);
  }
  if (!fs.existsSync(path.join(repoRoot(cwd), file))) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test file does not exist: ${file}`, {
      sessionId: session.id,
      operation: "update_ledger",
      nextSafeAction: "Create the linked test file or choose the correct relative test path.",
    });
  }
  if (session.state === states.COVERAGE_APPROVED) {
    session = updateState(session.id, states.TEST_GENERATED, cwd, { generatedTests: [file] });
  }
  const verifiedState = status === "passing" ? states.VERIFIED : states.TRIAGE_NEEDED;
  session = updateState(session.id, verifiedState, cwd, {
    generatedTests: [file],
    verification: { status, command },
  });
  const entry = upsertLedgerEntry({
    session,
    generatedTests: [file],
    status,
    command,
  }, cwd);
  return { session, entry };
}

export function triageSessionFailure({ sessionId, testOutput, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(sessionId, cwd);
  return triageFailure({ session, index, testOutput });
}
