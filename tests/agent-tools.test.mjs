import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { add_intent_marker, get_selector_candidates, list_sessions, start_capture } from "../src/agent-tools.mjs";
import { updateState, writeCaptureBuffer, writeIndex } from "../src/session-store.mjs";
import { states } from "../src/states.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  return root;
}

test("agent tools expose sessions, markers, and selector queries", () => {
  const cwd = tempProject();
  let session = start_capture({ url: "http://localhost:3000", description: "Agent API smoke", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [{ id: "evt-1", type: "click", label: "Save", selector: "[data-testid=\"save\"]" }],
    network: [],
    console: [],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  writeIndex(session, capture, cwd);
  const marker = add_intent_marker({ sessionId: session.id, type: "assert", note: "Save succeeds", stepId: "evt-1", cwd });
  assert.equal(marker.type, "assert");
  assert.equal(list_sessions({ cwd })[0].id, session.id);
  assert.deepEqual(get_selector_candidates({ sessionId: session.id, cwd }), [{
    selector: "[data-testid=\"save\"]",
    quality: "preferred",
    provenance: "tool_generated",
  }]);
});
