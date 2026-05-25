import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionSummaries,
  classifyConsoleEvents,
  classifyNetworkEvents,
  draftTestability,
  selectorAutomationAnalysis,
  testabilityFindings,
} from "../src/artifacts.mjs";

const baseIndex = {
  target: "http://localhost:5174/",
  events: [],
  network: [],
  console: [],
  selectorCandidates: [],
  humanMarkers: [],
  uncertainties: [],
};

test("dedupes testability findings with severity, counts, and samples", () => {
  const index = {
    ...baseIndex,
    events: [
      { id: "evt-1", type: "input", selector: "[data-testid=\"code\"]", label: "Reimbursement code", labelSource: "placeholder" },
      { id: "evt-2", type: "input", selector: "[data-testid=\"code\"]", label: "Reimbursement code", labelSource: "placeholder" },
      { id: "evt-3", type: "click", selector: "svg", label: "" },
    ],
    selectorCandidates: [{ selector: "main > div:nth-child(2) input", quality: "brittle" }],
  };

  const findings = testabilityFindings(index);
  assert.equal(findings.length, 3);
  assert.equal(findings.find((finding) => finding.key.startsWith("input:weak-label"))?.count, 2);
  assert.deepEqual(findings.find((finding) => finding.key.startsWith("input:weak-label"))?.sampleEventIds, ["evt-1", "evt-2"]);
  const markdown = draftTestability(index);
  assert.match(markdown, /\[MEDIUM\] Input relies on weak selector text \(2x\)/);
});

test("classifies canvas-only interactions as browser automation blockers", () => {
  const index = {
    ...baseIndex,
    events: [{ id: "evt-1", type: "click", selector: "canvas", label: "" }],
    selectorCandidates: [{ selector: "canvas", quality: "brittle" }],
  };

  const analysis = selectorAutomationAnalysis(index);
  assert.equal(analysis.overall, "low");
  assert.match(analysis.blockers[0].suggestedFix, /graph\/domain state/);

  const summaries = buildSessionSummaries({ id: "session", state: "CAPTURED", target: index.target, description: "", privacy: {}, repo: { testStack: {} } }, index);
  assert.equal(summaries.testabilitySummary.automationViability, "low");
  assert.equal(summaries.testabilitySummary.automationBlockers.length, 1);
});

test("classifies console and network signal separately from framework/static noise", () => {
  const index = {
    ...baseIndex,
    network: [
      { id: "net-1", method: "GET", url: "http://localhost:5174/src/App.tsx", status: 200, resourceType: "script" },
      { id: "net-2", method: "POST", url: "http://localhost:5174/api/login", status: 200, resourceType: "fetch" },
      { id: "net-3", method: "GET", url: "http://localhost:5174/api/private?token=%5BREDACTED%5D", status: 404, resourceType: "fetch" },
    ],
    console: [
      { id: "con-1", type: "warning", message: "React Router Future Flag Warning: test" },
      { id: "con-2", type: "error", message: "GET http://localhost:5174/missing 404 (Not Found)" },
    ],
  };

  const network = classifyNetworkEvents(index);
  assert.equal(network.appRelevantCount, 2);
  assert.equal(network.failingCount, 1);
  assert.equal(network.events[0].category, "static");
  assert.equal(network.events[1].category, "app-api");

  const console = classifyConsoleEvents(index);
  assert.equal(console.unexpectedCount, 1);
  assert.equal(console.events[0].classification, "known-framework-warning");
  assert.equal(console.events[1].classification, "network-404");

  const summaries = buildSessionSummaries({ id: "session", state: "CAPTURED", target: index.target, description: "", privacy: {} }, index);
  assert.equal(summaries.report.health.unexpectedConsoleEvents, 1);
  assert.equal(summaries.report.health.failingNetworkEvents, 1);
});
