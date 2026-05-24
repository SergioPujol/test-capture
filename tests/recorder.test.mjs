import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, readSession } from "../src/session-store.mjs";
import { recordInteractiveCapture } from "../src/recorder.mjs";
import { states } from "../src/states.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  return root;
}

test("failed capture setup does not advance a session to recording", async () => {
  const cwd = tempProject();
  const session = createSession({ url: "http://127.0.0.1:9", cwd });
  await assert.rejects(() => recordInteractiveCapture(session, { cwd }), {
    name: "TargetUnreachableError",
  });
  assert.equal(readSession(session.id, cwd).state, states.CREATED);
});
