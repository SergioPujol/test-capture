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

function jestOnlyProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-jest-"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "jest" },
    devDependencies: { jest: "^29.0.0" },
  }));
  fs.writeFileSync(path.join(root, "tests/diagram.test.ts"), "test('existing convention', () => {});\n");
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

test("scenario and coverage plan focus on durable outcomes and warn on intent mismatch", () => {
  const cwd = tempProject();
  let session = createSession({ url: "http://localhost:3000", description: "Customer can save billing email", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [
      { type: "click", label: "Billing", selector: "a[href='/billing']" },
      { type: "input", label: "Admin email", value: "admin@northstar.test", selector: "#admin-email" },
      { type: "input", label: "Password", value: "secret", selector: "#password" },
      { type: "input", label: "Access token", value: "1234", selector: "#access-token" },
      { type: "input", label: "Private billing memo", value: "private test", selector: "#private-memo" },
      { type: "click", label: "Submit sensitive flow", selector: "[data-testid=\"submit-sensitive-flow\"]" },
    ],
    network: [
      { method: "POST", url: "http://localhost:3000/api/login", status: 200 },
      { method: "GET", url: "http://localhost:3000/api/private?token=1234", status: 200 },
    ],
    console: [],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  writeIndex(session, capture, cwd);

  const scenario = generateScenario(session.id, cwd);
  assert.match(scenario.content, /Filled fields: Admin email, Password, Access token, Private billing memo/);
  assert.match(scenario.content, /Observed successful app\/network calls: POST \/api\/login \(200\), GET \/api\/private \(200\)/);
  assert.match(scenario.content, /Captured evidence is centered on a sensitive billing\/auth flow/);
  assert.match(scenario.content, /\[net-post-api-login\] assert POST \/api\/login returns 200/);
  assert.doesNotMatch(scenario.content, /Password" accepts the expected value/);

  approveScenario(session.id, cwd);
  const plan = generateCoveragePlan(session.id, cwd);
  assert.match(plan.content, /\[net-get-api-private\] assert GET \/api\/private returns 200/);
  assert.match(plan.content, /Description mentions saving a billing email/);
});

test("coverage plan adapts to Jest-only repos and weak canvas selectors", () => {
  const cwd = jestOnlyProject();
  let session = createSession({ url: "http://localhost:3000", description: "Rename selected diagram node", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [
      { type: "click", selector: "canvas", label: "" },
      { type: "input", selector: "#node-name", label: "Node name", value: "Decision" },
      { type: "click", selector: "[data-testid=\"rename-node\"]", label: "Rename node" },
    ],
    network: [],
    console: [],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  writeIndex(session, capture, cwd);
  generateScenario(session.id, cwd);
  approveScenario(session.id, cwd);
  const plan = generateCoveragePlan(session.id, cwd);
  assert.match(plan.content, /Strategy ID: state-integration/);
  assert.match(plan.content, /Detected frameworks: jest/);
  assert.match(plan.content, /Browser automation viability: low/);
  assert.match(plan.content, /tests\/rename-selected-diagram-node\.test\.ts/);
  assert.doesNotMatch(plan.content, /e2e\/rename-selected-diagram-node\.spec\.ts/);
  assert.doesNotMatch(plan.content, /npx playwright test/);
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
  assert.equal(linked.session.generatedTests[0].file, "e2e/admin-edits-billing-email.spec.ts");
  assert.equal(linked.session.generatedTests[0].coveragePlanHash, linked.session.coveragePlan.hash);
  assert.deepEqual(linked.session.generatedTests[0].assertionIds, ["net-patch-api-customer"]);
  const relinked = linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/admin-edits-billing-email.spec.ts",
    command: "pnpm e2e",
    cwd,
  });
  assert.equal(relinked.session.state, states.VERIFIED);
  assert.equal(readLedger(cwd)[0].status, "passing");
  assert.equal(readLedger(cwd)[0].coveragePlanHash, linked.session.coveragePlan.hash);
});

test("link-test requires a deviation reason when file differs from approved coverage plan", () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);
  generateScenario(session.id, cwd);
  approveScenario(session.id, cwd);
  generateCoveragePlan(session.id, cwd);
  approveCoveragePlan(session.id, cwd);
  fs.writeFileSync(path.join(cwd, "e2e/alternate.spec.ts"), "test('works', async () => {});\n");
  assert.throws(() => linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/alternate.spec.ts",
    command: "pnpm e2e",
    cwd,
  }), { name: "LedgerConsistencyError" });
  const linked = linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/alternate.spec.ts",
    command: "pnpm e2e",
    deviationReason: "Repository already has a consolidated capture-target spec.",
    cwd,
  });
  assert.equal(linked.session.generatedTests[0].deviationReason, "Repository already has a consolidated capture-target spec.");
});

test("link-test records strategy metadata and requires strategy deviation reasons", () => {
  const cwd = jestOnlyProject();
  let session = createSession({ url: "http://localhost:3000", description: "Rename selected diagram node", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  writeCaptureBuffer(session.id, {
    events: [{ type: "click", selector: "canvas", label: "" }],
    network: [],
    console: [],
  }, cwd);
  writeIndex(session, { events: [{ type: "click", selector: "canvas", label: "" }], network: [], console: [] }, cwd);
  generateScenario(session.id, cwd);
  approveScenario(session.id, cwd);
  generateCoveragePlan(session.id, cwd);
  approveCoveragePlan(session.id, cwd);
  fs.mkdirSync(path.join(cwd, "e2e"));
  fs.writeFileSync(path.join(cwd, "e2e/rename-selected-diagram-node.spec.ts"), "test('works', async () => {});\n");
  assert.throws(() => linkGeneratedTest({
    sessionId: session.id,
    file: "e2e/rename-selected-diagram-node.spec.ts",
    command: "npx playwright test",
    cwd,
  }), { name: "LedgerConsistencyError" });
  fs.writeFileSync(path.join(cwd, "tests/rename-selected-diagram-node.test.ts"), "test('works', () => {});\n");
  const linked = linkGeneratedTest({
    sessionId: session.id,
    file: "tests/rename-selected-diagram-node.test.ts",
    command: "npm run test",
    cwd,
  });
  assert.equal(linked.session.generatedTests[0].strategy, "state-integration");
  assert.equal(linked.session.generatedTests[0].linkedStrategy, "integration");
  assert.equal(readLedger(cwd)[0].strategy, "state-integration");
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
