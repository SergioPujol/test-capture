import { createSession, appendHumanMarker, listSessions, readIndex, readSession, sessionDir, writeTextArtifact } from "./session-store.mjs";
import { finalizeCapture, generateCoveragePlan, generateScenario, triageSessionFailure } from "./operations.mjs";
import { readLedger } from "./ledger.mjs";
import { draftAgentContext, draftTestability } from "./artifacts.mjs";
import { nowIso } from "./time.mjs";

export function start_capture({ url, description, privacy, cwd = process.cwd() }) {
  return createSession({ url, description, privacy, cwd });
}

export function stop_capture({ sessionId, cwd = process.cwd() } = {}) {
  return finalizeCapture(sessionId, cwd);
}

export function list_sessions({ cwd = process.cwd() } = {}) {
  return listSessions(cwd);
}

export function get_session_summary({ sessionId, cwd = process.cwd() }) {
  return generateScenario(sessionId, cwd);
}

export function get_step({ sessionId, step, cwd = process.cwd() }) {
  return readIndex(sessionId, cwd).events[step - 1] ?? null;
}

export function get_screenshot({ sessionId, screenshotId, cwd = process.cwd() }) {
  const screenshot = readIndex(sessionId, cwd).screenshots.find((item) => item.id === screenshotId);
  return screenshot ? { ...screenshot, absolutePath: `${sessionDir(sessionId, cwd)}/${screenshot.path}` } : null;
}

export function get_network_events({ sessionId, cwd = process.cwd() }) {
  return readIndex(sessionId, cwd).network;
}

export function get_console_events({ sessionId, cwd = process.cwd() }) {
  return readIndex(sessionId, cwd).console;
}

export function get_selector_candidates({ sessionId, cwd = process.cwd() }) {
  return readIndex(sessionId, cwd).selectorCandidates;
}

export function get_coverage_plan({ sessionId, cwd = process.cwd() }) {
  return generateCoveragePlan(sessionId, cwd);
}

export function get_testability_findings({ sessionId, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(sessionId, cwd);
  const content = draftTestability(index);
  writeTextArtifact(session.id, "testability.md", content, cwd);
  return { session, content };
}

export function triage_test_failure({ sessionId, testOutput, cwd = process.cwd() }) {
  return triageSessionFailure({ sessionId, testOutput, cwd });
}

export function get_ledger({ cwd = process.cwd() } = {}) {
  return readLedger(cwd);
}

export function write_agent_context({ sessionId, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(sessionId, cwd);
  const content = draftAgentContext(session, index);
  const path = writeTextArtifact(sessionId, "agent-context.md", content, cwd);
  return { path, content };
}

export function add_intent_marker({ sessionId, type, note = "", stepId, cwd = process.cwd() }) {
  const allowed = new Set(["assert", "ignore", "setup", "bug", "persist-after-reload", "split-test"]);
  if (!allowed.has(type)) throw new Error(`Unsupported marker type: ${type}`);
  return appendHumanMarker(sessionId, {
    id: `marker-${Date.now()}`,
    type,
    note,
    stepId,
    timestamp: nowIso(),
    provenance: "human_approved",
  }, cwd);
}
