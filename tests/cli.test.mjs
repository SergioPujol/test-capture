import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.mjs";
import { createSession, updateState, writeCaptureBuffer, writeIndex } from "../src/session-store.mjs";
import { generateScenario } from "../src/operations.mjs";
import { states } from "../src/states.mjs";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-cli-"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  return root;
}

async function captureOutput(fn) {
  const original = console.log;
  const chunks = [];
  console.log = (value) => chunks.push(String(value));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return chunks.join("\n");
}

async function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function capturedSession(cwd) {
  let session = createSession({ url: "http://localhost:5174", description: "CLI report smoke", cwd });
  session = updateState(session.id, states.RECORDING, cwd);
  session = updateState(session.id, states.CAPTURED, cwd);
  const capture = {
    events: [
      { id: "evt-1", type: "input", label: "Admin email", labelSource: "label", selector: "#admin-email", value: "admin@example.test" },
      { id: "evt-2", type: "input", label: "Reimbursement code", labelSource: "placeholder", selector: "[data-testid=\"code\"]", value: "reimbursement-code-test" },
      { id: "evt-3", type: "click", label: "Submit sensitive flow", selector: "[data-testid=\"submit-sensitive-flow\"]" },
    ],
    network: [
      { id: "net-1", method: "GET", url: "http://localhost:5174/src/App.tsx", status: 200, resourceType: "script" },
      { id: "net-2", method: "POST", url: "http://localhost:5174/api/login", status: 200, resourceType: "fetch" },
    ],
    console: [
      { id: "con-1", type: "warning", message: "React Router Future Flag Warning: test" },
    ],
    screenshots: [],
    humanMarkers: [],
    uncertainties: [],
  };
  writeCaptureBuffer(session.id, capture, cwd);
  writeIndex(session, capture, cwd);
  generateScenario(session.id, cwd);
  return session;
}

test("CLI exposes report, console summary, app-only network, compact sessions, and human doctor", async () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);

  await withCwd(cwd, async () => {
    const report = await captureOutput(() => runCli(["report", session.id]));
    assert.match(report, /# Test Capture Report/);
    assert.match(report, /App-relevant network events: 1\/2/);

    const network = JSON.parse(await captureOutput(() => runCli(["network", session.id, "--app-only"])));
    assert.equal(network.length, 1);
    assert.equal(network[0].category, "app-api");

    const consoleSummary = JSON.parse(await captureOutput(() => runCli(["console", session.id])));
    assert.equal(consoleSummary.unexpectedCount, 0);
    assert.equal(consoleSummary.events[0].classification, "known-framework-warning");

    const sessions = JSON.parse(await captureOutput(() => runCli(["list-sessions", "--compact"])));
    assert.equal(sessions[0].id, session.id);
    assert.equal(typeof sessions[0].sizeBytes, "number");

    const doctor = await captureOutput(() => runCli(["doctor"]));
    assert.match(doctor, /Test Capture doctor/);
    assert.match(doctor, /Status: /);
    assert.match(doctor, /Chromium launchable: /);
    assert.match(doctor, /Target URL: not checked/);
  });
});

test("doctor reports target URL failures in machine-readable setup status", async () => {
  const cwd = tempProject();
  const url = "http://127.0.0.1:9";

  await withCwd(cwd, async () => {
    const doctor = JSON.parse(await captureOutput(() => runCli(["doctor", "--url", url, "--json"])));
    assert.equal(doctor.ok, false);
    assert.equal(doctor.target.url, url);
    assert.equal(doctor.target.reachable, false);
    assert.match(doctor.nextActions.join("\n"), /Start the target app server/);
  });
});

test("CLI exposes evidence-pack, test-outline, and evidence-add", async () => {
  const cwd = tempProject();
  const session = capturedSession(cwd);

  await withCwd(cwd, async () => {
    const pack = await captureOutput(() => runCli(["evidence-pack", session.id]));
    assert.match(pack, /# Evidence Pack/);
    assert.match(pack, /Field Admin email was edited; typed value is masked/);

    const jsonPack = JSON.parse(await captureOutput(() => runCli(["evidence-pack", session.id, "--json"])));
    assert.equal(jsonPack.sessionId, session.id);
    assert.ok(jsonPack.facts.some((fact) => fact.classification === "masked"));

    const added = JSON.parse(await captureOutput(() => runCli([
      "evidence-add",
      session.id,
      "--fact",
      "Final screenshot shows node name 95-t.",
      "--source",
      "screenshots/0002.png",
      "--classification",
      "observed",
    ])));
    assert.equal(added.fact.fact, "Final screenshot shows node name 95-t.");
    assert.equal(added.fact.classification, "observed");
    assert.equal(typeof added.fact.approvedAt, "string");

    const outline = await captureOutput(() => runCli(["test-outline", session.id]));
    assert.match(outline, /# Test Outline/);
    assert.match(outline, /Final screenshot shows node name 95-t/);

    const jsonOutline = JSON.parse(await captureOutput(() => runCli(["test-outline", session.id, "--json"])));
    assert.equal(jsonOutline.sessionId, session.id);
    assert.ok(Array.isArray(jsonOutline.requiredAssertions));

    const pending = JSON.parse(await captureOutput(() => runCli([
      "evidence-add",
      session.id,
      "--fact",
      "Reviewer confirmed screenshot value 95-t.",
      "--source",
      "screenshots/0002.png",
      "--classification",
      "observed",
      "--requires-approval",
    ])));
    assert.equal(pending.fact.approvedAt, null);

    const approved = JSON.parse(await captureOutput(() => runCli([
      "evidence-approve",
      session.id,
      "--fact-id",
      pending.fact.id,
    ])));
    assert.equal(approved.fact.id, pending.fact.id);
    assert.equal(typeof approved.fact.approvedAt, "string");
  });
});
