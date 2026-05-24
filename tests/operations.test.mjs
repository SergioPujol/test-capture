import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, updateState, writeCaptureBuffer, writeIndex } from "../src/session-store.mjs";
import { states } from "../src/states.mjs";
import {
  approveCoveragePlan,
  approveScenario,
  generateCoveragePlan,
  generateScenario,
  linkGeneratedTest,
  triageSessionFailure,
} from "../src/operations.mjs";
import { readLedger } from "../src/ledger.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-"));
  fs.mkdirSync(path.join(root, "e2e"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { e2e: "playwright test" },
    devDependencies: { playwright: "^1.44.0" },
  }));
  return root;
}

function capturedSession(cwd) {
  let session = createSession({ url: "http://localhost:3000", description: "Admin edits billing email", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [
      { type: "click", label: "Edit billing email", selector: "[data-testid=\"edit-billing-email\"]" },
      { type: "input", label: "Billing email", value: "finance@example.com", selector: "#billing-email" },
    ],
    network: [{ method: "PATCH", url: "http://localhost:3000/api/customer", status: 200 }],
    console: [],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  writeIndex(session, capture, cwd);
  return session;
}

test("generates scenario and requires approval before coverage plan", () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);
  const scenario = generateScenario(session.id, cwd);
  assert.match(scenario.content, /Admin edits billing email/);
  assert.throws(() => generateCoveragePlan(session.id, cwd), {
    name: "InvalidSessionTransitionError",
  });
  approveScenario(session.id, cwd);
  const plan = generateCoveragePlan(session.id, cwd);
  assert.match(plan.content, /Proposed Test File/);
  assert.match(plan.content, /e2e\/admin-edits-billing-email.spec.ts/);
});

test("refuses scenario generation for empty captures without advancing state", () => {
  const cwd = tempProject();
  let session = createSession({ url: "http://localhost:3000", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  writeIndex(session, { events: [], network: [], console: [], screenshots: [] }, cwd);
  assert.throws(() => generateScenario(session.id, cwd), {
    name: "InvalidSessionTransitionError",
  });
});

test("updates ledger only when linked test exists", () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);
  generateScenario(session.id, cwd);
  approveScenario(session.id, cwd);
  generateCoveragePlan(session.id, cwd);
  assert.throws(() => linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/admin-edits-billing-email.spec.ts",
    command: "pnpm e2e",
    cwd,
  }), { name: "InvalidSessionTransitionError" });
  approveCoveragePlan(session.id, cwd);
  assert.throws(() => linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/missing.spec.ts",
    command: "pnpm e2e",
    cwd,
  }), { name: "LedgerConsistencyError" });
  fs.writeFileSync(path.join(cwd, "e2e/admin-edits-billing-email.spec.ts"), "test('works', async () => {});\n");
  const linked = linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/admin-edits-billing-email.spec.ts",
    command: "pnpm e2e",
    cwd,
  });
  assert.equal(linked.session.state, states.VERIFIED);
  assert.equal(readLedger(cwd)[0].status, "passing");
});

test("triages selector failures with capture evidence", () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);
  const result = triageSessionFailure({
    sessionId: session.id,
    testOutput: "Error: locator('[data-testid=missing]').not found",
    cwd,
  });
  assert.equal(result.classification, "selector is brittle");
});
