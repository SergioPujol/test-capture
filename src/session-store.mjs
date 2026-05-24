import fs from "node:fs";
import path from "node:path";
import { captureError, errorNames } from "./errors.mjs";
import { sessionRoot } from "./paths.mjs";
import { detectRepo } from "./repo.mjs";
import { buildAgentSafeIndex } from "./indexer.mjs";
import { states, assertTransition } from "./states.mjs";
import { nowIso, safeTimestamp } from "./time.mjs";

export function sessionDir(sessionId, cwd = process.cwd()) {
  return path.join(sessionRoot(cwd), sessionId);
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  } catch (error) {
    throw captureError(errorNames.ArtifactWriteError, `Could not write artifact ${file}.`, {
      operation: "write_session_artifact",
      nextSafeAction: "Check filesystem permissions and disk space, then retry.",
      cause: error.message,
    });
  }
}

function readJson(file, operation = "read_session_artifact") {
  if (!fs.existsSync(file)) {
    throw captureError(errorNames.SessionArtifactNotFoundError, `Missing artifact ${file}.`, {
      operation,
      nextSafeAction: "List sessions and verify the session id.",
    });
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function createSession({ url, description, cwd = process.cwd(), privacy = {} }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw captureError(errorNames.InvalidTargetUrlError, "A valid http:// or https:// target URL is required.", {
      operation: "start_capture",
      nextSafeAction: "Run start again with --url http://localhost:<port>.",
    });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw captureError(errorNames.InvalidTargetUrlError, "Capture target must use http:// or https://.", {
      operation: "start_capture",
      nextSafeAction: "Use a local or test environment HTTP URL.",
    });
  }
  const base = safeTimestamp();
  const slug = parsed.hostname.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const id = `${slug}-${base}`;
  const timestamp = nowIso();
  const session = {
    id,
    state: states.CREATED,
    target: parsed.toString(),
    description: description ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
    privacy: {
      allowScreenshots: Boolean(privacy.allowScreenshots),
      allowNetworkBodies: Boolean(privacy.allowNetworkBodies),
      allowTypedText: Boolean(privacy.allowTypedText),
    },
    repo: detectRepo(cwd),
    generatedTests: [],
    verification: null,
  };
  fs.mkdirSync(path.join(sessionDir(id, cwd), "screenshots"), { recursive: true });
  writeJson(path.join(sessionDir(id, cwd), "session.json"), session);
  writeJson(path.join(sessionDir(id, cwd), "agent-safe-index.json"), buildAgentSafeIndex(session));
  return session;
}

export function readSession(sessionId, cwd = process.cwd()) {
  const session = readJson(path.join(sessionDir(sessionId, cwd), "session.json"));
  return session;
}

export function writeSession(session, cwd = process.cwd()) {
  writeJson(path.join(sessionDir(session.id, cwd), "session.json"), session);
  return session;
}

export function updateState(sessionId, nextState, cwd = process.cwd(), patch = {}) {
  const session = readSession(sessionId, cwd);
  assertTransition(session.state, nextState, sessionId);
  const updated = { ...session, ...patch, state: nextState, updatedAt: nowIso() };
  writeSession(updated, cwd);
  return updated;
}

export function writeIndex(session, capture, cwd = process.cwd()) {
  const index = buildAgentSafeIndex(session, capture);
  writeJson(path.join(sessionDir(session.id, cwd), "agent-safe-index.json"), index);
  return index;
}

export function writeCaptureBuffer(sessionId, capture, cwd = process.cwd()) {
  writeJson(path.join(sessionDir(sessionId, cwd), "capture-buffer.json"), capture);
  return capture;
}

export function readCaptureBuffer(sessionId, cwd = process.cwd()) {
  const file = path.join(sessionDir(sessionId, cwd), "capture-buffer.json");
  if (!fs.existsSync(file)) return { events: [], network: [], console: [], screenshots: [], humanMarkers: [], uncertainties: [] };
  return readJson(file, "read_capture_buffer");
}

export function appendHumanMarker(sessionId, marker, cwd = process.cwd()) {
  const capture = readCaptureBuffer(sessionId, cwd);
  capture.humanMarkers = capture.humanMarkers ?? [];
  capture.humanMarkers.push(marker);
  writeCaptureBuffer(sessionId, capture, cwd);
  const session = readSession(sessionId, cwd);
  writeIndex(session, capture, cwd);
  return marker;
}

export function readIndex(sessionId, cwd = process.cwd()) {
  return readJson(path.join(sessionDir(sessionId, cwd), "agent-safe-index.json"), "get_session_summary");
}

export function writeTextArtifact(sessionId, name, content, cwd = process.cwd()) {
  const file = path.join(sessionDir(sessionId, cwd), name);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`);
    return file;
  } catch (error) {
    throw captureError(errorNames.ArtifactWriteError, `Could not write artifact ${name}.`, {
      sessionId,
      operation: "write_session_artifact",
      nextSafeAction: "Check filesystem permissions and retry.",
      cause: error.message,
    });
  }
}

export function listSessions(cwd = process.cwd()) {
  const root = sessionRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readSession(entry.name, cwd);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function latestRecordingSession(cwd = process.cwd()) {
  return listSessions(cwd).find((session) => session.state === states.RECORDING);
}
