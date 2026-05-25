import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidencePack,
  buildSessionSummaries,
  buildTestOutline,
  classifyConsoleEvents,
  classifyNetworkEvents,
  draftTestability,
  selectorRecommendations,
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

test("builds evidence pack for canvas, masked input, console state, screenshots, and recommended locators", () => {
  const index = {
    ...baseIndex,
    events: [
      { id: "evt-1", type: "click", selector: "canvas", label: "" },
      { id: "evt-2", type: "input", selector: "#node-name", label: "Node name", labelSource: "label", value: "[MASKED]" },
      { id: "evt-3", type: "click", selector: "button", label: "SAVE NAME", labelSource: "text", role: "button" },
      { id: "evt-4", type: "input", selector: "[data-testid=\"node-code\"]", label: "Node code", labelSource: "placeholder", value: "[MASKED]" },
      { id: "evt-5", type: "click", selector: "a[href=\"/billing\"]", label: "Billing" },
    ],
    console: [
      { id: "con-1", type: "log", message: "Rendering DiagramCanvas { selectedNodeId: node-95 }" },
    ],
    screenshots: [
      { id: "shot-1", path: "screenshots/0001.png", label: "initial" },
      { id: "shot-2", path: "screenshots/0002.png", label: "final" },
    ],
  };
  const session = {
    id: "session",
    target: index.target,
    description: "Rename selected diagram node",
    evidenceFacts: [],
  };

  const pack = buildEvidencePack(session, index);
  assert.ok(pack.facts.some((fact) => fact.fact.includes("selected node id node-95") && fact.classification === "inferred"));
  assert.ok(pack.facts.some((fact) => fact.fact.includes("typed value is masked") && fact.classification === "masked"));
  assert.ok(pack.facts.some((fact) => fact.fact.includes("Raw canvas click") && fact.classification === "substituted"));
  assert.ok(pack.facts.some((fact) => fact.source.includes("screenshots/0002.png") && fact.requiresApproval));
  assert.ok(pack.selectorRecommendations.some((item) => item.recommendedLocator === 'page.getByLabel("Node name")'));
  assert.ok(pack.selectorRecommendations.some((item) => item.recommendedLocator === 'page.getByRole("button", { name: "SAVE NAME" })'));
  assert.ok(pack.selectorRecommendations.some((item) => item.recommendedLocator === 'page.getByTestId("node-code")'));
  assert.ok(pack.selectorRecommendations.some((item) => item.recommendedLocator === 'page.getByRole("link", { name: "Billing" })'));

  const outline = buildTestOutline(session, index);
  assert.equal(outline.evidencePack, "evidence-pack.json");
  assert.ok(outline.blockedFacts.some((fact) => fact.classification === "masked"));
  assert.ok(outline.substitutionRequirements.some((item) => /deviation\/substitution reason/.test(item)));

  const recommendations = selectorRecommendations(index);
  assert.equal(recommendations.length, 4);
});
