import { states } from "./states.mjs";
import crypto from "node:crypto";
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
  writeJsonArtifact,
  writeSession,
  writeTextArtifact,
} from "./session-store.mjs";
import {
  buildSessionSummaries,
  draftAgentContext,
  draftCoveragePlan,
  draftReport,
  draftScenario,
  draftTestability,
} from "./artifacts.mjs";
import { upsertLedgerEntry } from "./ledger.mjs";
import { triageFailure } from "./triage.mjs";
import { captureError, errorNames } from "./errors.mjs";
import { nowIso } from "./time.mjs";

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

function coveragePlanFile(sessionId, cwd = process.cwd()) {
  return path.join(repoRoot(cwd), ".test-capture", "sessions", sessionId, "coverage-plan.md");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function parseCoveragePlanMetadata(content) {
  const rawProposedTestFile = content.match(/## Proposed Test File\s*\n\s*- ([^\n]+)/)?.[1]?.trim() ?? null;
  const proposedTestFile = rawProposedTestFile && !rawProposedTestFile.startsWith("BLOCKED:")
    ? rawProposedTestFile
    : null;
  const assertionsSection = content.match(/## Assertions To Include\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  const assertionIds = [...assertionsSection.matchAll(/^- \[([^\]]+)\]/gm)].map((match) => match[1]);
  return {
    hash: hashContent(content),
    proposedTestFile,
    strategy: content.match(/^- Strategy ID: ([^\n]+)/m)?.[1]?.trim() ?? null,
    strategyLabel: content.match(/^- Strategy: ([^\n]+)/m)?.[1]?.trim() ?? null,
    runnerCommand: content.match(/^- Recommended command: ([^\n]+)/m)?.[1]?.trim() ?? null,
    assertionIds,
  };
}

function readOrWriteCoveragePlan(session, index, cwd = process.cwd()) {
  const file = coveragePlanFile(session.id, cwd);
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : draftCoveragePlan(session, index);
  if (!fs.existsSync(file)) writeTextArtifact(session.id, "coverage-plan.md", content, cwd);
  return { content, ...parseCoveragePlanMetadata(content) };
}

function normalizedGeneratedTests(generatedTests = []) {
  return generatedTests.map((item) => typeof item === "string" ? { file: item } : item);
}

function upsertGeneratedTestLink(existingLinks, link) {
  const links = normalizedGeneratedTests(existingLinks);
  const index = links.findIndex((item) => item.file === link.file);
  if (index >= 0) links[index] = { ...links[index], ...link };
  else links.push(link);
  return links;
}

function inferredLinkedStrategy(file, command = "") {
  const combined = `${file} ${command}`;
  if (/playwright|cypress|(^|\/)e2e\//i.test(combined)) return "browser-e2e";
  if (/jest|vitest|node --test|(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(combined)) return "integration";
  return "unknown";
}

function strategyFamily(strategy) {
  if (strategy === "browser-e2e") return "browser-e2e";
  if (["integration", "state-integration"].includes(strategy)) return "integration";
  return strategy || "unknown";
}

export function writeSessionSummaries(session, index, cwd = process.cwd()) {
  const summaries = buildSessionSummaries(session, index);
  writeJsonArtifact(session.id, "event-summary.json", summaries.eventSummary, cwd);
  writeJsonArtifact(session.id, "network-summary.json", summaries.networkSummary, cwd);
  writeJsonArtifact(session.id, "console-summary.json", summaries.consoleSummary, cwd);
  writeJsonArtifact(session.id, "testability-summary.json", summaries.testabilitySummary, cwd);
  writeTextArtifact(session.id, "report.md", draftReport(session, index), cwd);
  return summaries;
}

export function finalizeCapture(sessionId, cwd = process.cwd()) {
  const session = sessionId ? readSession(sessionId, cwd) : latestRecordingSession(cwd);
  if (!session) return null;
  const captured = session.state === states.RECORDING
    ? updateState(session.id, states.CAPTURED, cwd)
    : session;
  const capture = readCaptureBuffer(captured.id, cwd);
  const index = writeIndex(captured, capture, cwd);
  writeSessionSummaries(captured, index, cwd);
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
  writeSessionSummaries(session, index, cwd);
  writeTextArtifact(session.id, "scenario.md", content, cwd);
  writeTextArtifact(session.id, "testability.md", draftTestability(index), cwd);
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
    throw captureError(errorNames.InvalidSessionTransitionError, "Scenario must be approved before coverage planning.", {
      sessionId: session.id,
      operation: "get_coverage_plan",
      nextSafeAction: `Run: test-capture approve-scenario ${session.id}`,
    });
  }
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  if (session.state === states.SCENARIO_APPROVED) session = updateState(session.id, states.COVERAGE_PLANNED, cwd);
  const content = draftCoveragePlan(session, index);
  writeSessionSummaries(session, index, cwd);
  writeTextArtifact(session.id, "coverage-plan.md", content, cwd);
  writeTextArtifact(session.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session: readSession(session.id, cwd), content };
}

export function approveCoveragePlan(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  const coveragePlan = readOrWriteCoveragePlan(session, index, cwd);
  return updateState(session.id, states.COVERAGE_APPROVED, cwd, { coveragePlan });
}

export function linkGeneratedTest({ sessionId, file, command, status = "passing", deviationReason, cwd = process.cwd() }) {
  let session = readSession(sessionId, cwd);
  if (!atLeast(session.state, states.COVERAGE_APPROVED)) {
    throw captureError(errorNames.InvalidSessionTransitionError, "Coverage plan must be approved before linking generated tests.", {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Run: test-capture approve-coverage-plan ${session.id}`,
    });
  }
  if (!["passing", "failing"].includes(status)) {
    throw captureError(errorNames.LedgerConsistencyError, `Unsupported verification status: ${status}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: "Use --status passing or --status failing.",
    });
  }
  if (!fs.existsSync(path.join(repoRoot(cwd), file))) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test file does not exist: ${file}`, {
      sessionId: session.id,
      operation: "update_ledger",
      nextSafeAction: "Create the linked test file or choose the correct relative test path.",
    });
  }
  const index = readIndex(session.id, cwd);
  const coveragePlan = session.coveragePlan ?? readOrWriteCoveragePlan(session, index, cwd);
  if (coveragePlan.proposedTestFile && file !== coveragePlan.proposedTestFile && !deviationReason) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test file differs from approved coverage plan: ${file}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Use the approved path ${coveragePlan.proposedTestFile}, or pass --deviation-reason to explain the different file.`,
    });
  }
  const linkedStrategy = inferredLinkedStrategy(file, command);
  if (coveragePlan.strategy && strategyFamily(coveragePlan.strategy) !== strategyFamily(linkedStrategy) && !deviationReason) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test strategy differs from approved coverage plan: ${linkedStrategy}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Use the approved strategy ${coveragePlan.strategy}, or pass --deviation-reason to explain the different test shape.`,
    });
  }
  const link = {
    file,
    status,
    command,
    coveragePlanHash: coveragePlan.hash,
    assertionIds: coveragePlan.assertionIds,
    strategy: coveragePlan.strategy,
    strategyLabel: coveragePlan.strategyLabel,
    linkedStrategy,
    deviationReason: deviationReason || null,
    linkedAt: nowIso(),
  };
  const generatedTests = upsertGeneratedTestLink(session.generatedTests, link);
  const verification = {
    status,
    command,
    coveragePlanHash: coveragePlan.hash,
    assertionIds: coveragePlan.assertionIds,
    strategy: coveragePlan.strategy,
    linkedStrategy,
    verifiedAt: link.linkedAt,
  };
  if (session.state === states.COVERAGE_APPROVED) {
    session = updateState(session.id, states.TEST_GENERATED, cwd, { generatedTests, coveragePlan });
  }
  if (session.state === states.TRIAGE_NEEDED) {
    session = updateState(session.id, states.TEST_GENERATED, cwd, { generatedTests, coveragePlan });
  }
  const verifiedState = status === "passing" ? states.VERIFIED : states.TRIAGE_NEEDED;
  if (session.state !== verifiedState) {
    session = updateState(session.id, verifiedState, cwd, {
      generatedTests,
      coveragePlan,
      verification,
    });
  } else {
    session = writeSession({ ...session, generatedTests, coveragePlan, verification }, cwd);
  }
  const entry = upsertLedgerEntry({
    session,
    generatedTests,
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
