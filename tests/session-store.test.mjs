import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, readIndex, readSession, updateState, writeCaptureBuffer, writeIndex } from "../src/session-store.mjs";
import { states } from "../src/states.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  return root;
}

test("creates a session with repo signals and an empty agent-safe index", () => {
  const cwd = tempProject();
  const session = createSession({ url: "http://localhost:3000", description: "Smoke test", cwd });
  const loaded = readSession(session.id, cwd);
  const index = readIndex(session.id, cwd);
  assert.equal(loaded.state, states.CREATED);
  assert.equal(index.sessionId, session.id);
  assert.equal(index.events.length, 0);
  assert.equal(loaded.repo.hasPackageJson, true);
  assert.deepEqual(loaded.repo.gitignoreWarnings, []);
});

test("rejects invalid state transitions", () => {
  const cwd = tempProject();
  const session = createSession({ url: "http://localhost:3000", cwd });
  assert.throws(() => updateState(session.id, states.VERIFIED, cwd), {
    name: "InvalidSessionTransitionError",
  });
});

test("indexes redacted captured events", () => {
  const cwd = tempProject();
  let session = createSession({ url: "http://localhost:3000", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [{ type: "input", label: "Password", value: "secret", selector: "#password" }],
    network: [{ method: "GET", url: "http://localhost:3000/api?token=abc", status: 200 }],
    console: [{ type: "error", message: "Bearer abc" }],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  const index = writeIndex(session, capture, cwd);
  assert.equal(index.events[0].value, "[REDACTED]");
  assert.match(index.network[0].url, /token=%5BREDACTED%5D/);
  assert.equal(index.console[0].message, "Bearer [REDACTED]");
});
