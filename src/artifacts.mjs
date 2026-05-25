import { provenance } from "./provenance.mjs";

function title(text) {
  return text?.trim() || "Captured browser verification";
}

function stableId(prefix, text) {
  const slug = String(text || "evidence")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44);
  return `${prefix}-${slug || "item"}`;
}

function severityRank(severity) {
  return { high: 3, medium: 2, low: 1, info: 0 }[severity] ?? 0;
}

function addFinding(findings, finding) {
  const existing = findings.get(finding.key);
  if (existing) {
    existing.count += finding.count ?? 1;
    existing.sampleEventIds = [...new Set([...existing.sampleEventIds, ...(finding.sampleEventIds ?? [])])].slice(0, 5);
    if (severityRank(finding.severity) > severityRank(existing.severity)) existing.severity = finding.severity;
    return;
  }
  findings.set(finding.key, {
    count: 1,
    sampleEventIds: [],
    ...finding,
  });
}

function statusFamily(status) {
  if (status === 0) return "failed";
  if (status >= 500) return "server-error";
  if (status >= 400) return "client-error";
  if (status >= 300) return "redirect";
  if (status >= 200) return "success";
  return "unknown";
}

function urlInfo(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
      endpoint: parsed.pathname,
    };
  } catch {
    return {
      origin: "",
      pathname: rawUrl.split("?")[0] || rawUrl,
      endpoint: rawUrl.split("?")[0] || rawUrl,
    };
  }
}

function networkCategory(event, targetOrigin) {
  const info = urlInfo(event.url);
  const sameOrigin = !targetOrigin || info.origin === targetOrigin;
  const isApi = sameOrigin && /^\/api(\/|$)/.test(info.pathname);
  const isStatic = /^(script|stylesheet|image|font)$/.test(event.resourceType || "")
    || /\/(@vite|src|node_modules|assets)\//.test(info.pathname)
    || /^\/@vite|^\/@react-refresh/.test(info.pathname)
    || /\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/i.test(info.pathname);
  return {
    ...info,
    category: isApi ? "app-api" : isStatic ? "static" : sameOrigin ? "app" : "external",
  };
}

export function intentEvidence(index) {
  const meaningfulEvents = index.events.filter((event) => !["navigation", "load"].includes(event.type));
  const targetOrigin = urlInfo(index.target).origin;
  const fields = new Map();
  const actions = [];
  const visibleText = [];
  for (const event of meaningfulEvents) {
    const label = event.label || event.role || event.selector || event.url || "";
    if (event.type === "input") {
      const key = event.selector || event.label || `input-${fields.size + 1}`;
      fields.set(key, {
        id: stableId("field", event.label || event.selector),
        label: event.label || event.selector || "unlabeled input",
        selector: event.selector,
        labelSource: event.labelSource,
        value: event.value,
      });
    }
    if (event.type === "click") {
      actions.push({
        id: stableId("action", label),
        label: label || "unnamed click target",
        selector: event.selector,
      });
    }
    if (event.type === "text" && event.text) {
      visibleText.push({
        id: stableId("text", event.text),
        text: event.text,
      });
    }
  }
  const network = index.network
    .filter((event) => event.method || event.url)
    .map((event) => {
      const info = networkCategory(event, targetOrigin);
      return {
        id: stableId("net", `${event.method || "GET"} ${info.endpoint}`),
        method: event.method || "GET",
        url: event.url,
        endpoint: info.endpoint,
        category: info.category,
        appRelevant: ["app-api", "app"].includes(info.category),
        status: event.status,
        resourceType: event.resourceType,
      };
    })
    .filter((event) => event.appRelevant)
    .map((event) => ({
      id: event.id,
      method: event.method,
      url: event.url,
      endpoint: event.endpoint,
      category: event.category,
      appRelevant: event.appRelevant,
      status: event.status,
      resourceType: event.resourceType,
    }));
  return {
    fields: [...fields.values()],
    actions,
    network,
    visibleText,
    console: index.console ?? [],
    markers: index.humanMarkers ?? [],
  };
}

function mainBehavior(index) {
  const evidence = intentEvidence(index);
  const lines = [];
  if (evidence.fields.length) {
    lines.push(`- Filled fields: ${evidence.fields.map((field) => field.label).join(", ")}`);
  }
  if (evidence.actions.length) {
    lines.push(`- Performed actions: ${evidence.actions.map((action) => action.label).join(", ")}`);
  }
  const successfulCalls = evidence.network.filter((event) => event.category === "app-api" && event.status >= 200 && event.status < 300);
  if (successfulCalls.length) {
    lines.push(`- Observed successful app/network calls: ${successfulCalls.map((event) => `${event.method} ${event.endpoint} (${event.status})`).join(", ")}`);
  }
  if (evidence.visibleText.length) {
    lines.push(`- Observed visible outcomes: ${evidence.visibleText.map((event) => event.text).join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "No user behavior was captured yet.";
}

export function assertionCandidates(index) {
  const evidence = intentEvidence(index);
  const candidates = [];
  for (const event of evidence.network.filter((item) => item.category === "app-api")) {
    if (event.status >= 200 && event.status < 300) {
      candidates.push({
        id: event.id,
        text: `assert ${event.method} ${event.endpoint} returns ${event.status}`,
      });
    }
  }
  for (const marker of evidence.markers.filter((marker) => marker.type === "assert")) {
    candidates.push({
      id: stableId("marker", marker.id || marker.note),
      text: `assert marked outcome: ${marker.note || marker.stepId || marker.id}`,
    });
  }
  for (const event of evidence.visibleText) {
    candidates.push({
      id: event.id,
      text: `assert "${event.text}" is visible`,
    });
  }
  if (classifyConsoleEvents(index).unexpectedCount > 0) {
    candidates.push({
      id: "console-review-unexpected-errors",
      text: "assert the flow does not produce unexpected console errors after known issues are reviewed",
    });
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).slice(0, 10);
}

export function scenarioMismatchWarnings(session, index) {
  const description = session.description || "";
  const evidence = intentEvidence(index);
  const observedText = [
    ...evidence.fields.map((field) => field.label),
    ...evidence.actions.map((action) => action.label),
    ...evidence.network.map((event) => event.endpoint),
  ].join(" ").toLowerCase();
  const warnings = [];
  if (/save|saved|update|edit/i.test(description) && /billing email/i.test(description) && !/billing email/i.test(observedText)) {
    warnings.push("Description mentions saving a billing email, but captured evidence does not show a Billing email field or matching save request.");
  }
  if (/billing email/i.test(description) && /(password|access token|private|memo|\/api\/private|\/api\/login)/i.test(observedText)) {
    warnings.push("Captured evidence is centered on a sensitive billing/auth flow; confirm this is the intended business scenario before generating a test.");
  }
  return warnings;
}

function selectorViabilityForSelector(selector = "", event = {}) {
  if (!selector) return { level: "low", reason: "no selector was captured" };
  if (/canvas/i.test(selector)) {
    return { level: "low", reason: "primary target is canvas, which has no DOM-level element identity" };
  }
  if (/svg/i.test(selector) && !event.label) {
    return { level: "low", reason: "primary target is raw SVG with no accessible name" };
  }
  if (/nth-child| > |\.css-|:has\(|^body\b/i.test(selector)) {
    return { level: "low", reason: "selector is coupled to DOM structure or generated styling" };
  }
  if (/getBy(Role|Label|Text|TestId)|\[data-testid=|\[data-test=|\[data-cy=/.test(selector)) {
    return { level: "high", reason: "selector uses role, label, text, or stable test id" };
  }
  if (/^#[A-Za-z][\w-]*$/.test(selector) || /\[[\w-]+=["'][^"']+["']\]/.test(selector)) {
    return { level: "medium", reason: "selector is stable-looking but should be checked against repo conventions" };
  }
  if (!event.label && ["click", "input"].includes(event.type)) {
    return { level: "low", reason: "interaction target lacks an accessible label or name" };
  }
  return { level: "medium", reason: "selector may work but should be reviewed before browser automation" };
}

function worseViability(a, b) {
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  return (rank[a] ?? 0) <= (rank[b] ?? 0) ? a : b;
}

export function selectorAutomationAnalysis(index) {
  const interactionEvents = (index.events ?? []).filter((event) => ["click", "input"].includes(event.type));
  const analyzedEvents = interactionEvents.map((event) => {
    const viability = selectorViabilityForSelector(event.selector, event);
    return {
      eventId: event.id,
      type: event.type,
      selector: event.selector,
      label: event.label,
      viability: viability.level,
      reason: viability.reason,
    };
  });
  const overall = analyzedEvents.reduce((level, event) => worseViability(level, event.viability), analyzedEvents.length ? "high" : "unknown");
  const blockers = analyzedEvents
    .filter((event) => event.viability === "low")
    .map((event) => ({
      eventId: event.eventId,
      selector: event.selector,
      reason: event.reason,
      suggestedFix: /canvas/i.test(event.selector || "")
        ? "Test the graph/domain state directly, or expose stable app instrumentation before generating a browser e2e test."
        : /svg/i.test(event.selector || "")
          ? "Add an accessible name or click a named parent control before relying on browser automation."
          : "Add a stable role, label, text, or test id before relying on browser automation.",
    }));
  const guidance = overall === "low"
    ? "Browser automation viability is low. Prefer lower-level state/model coverage or add instrumentation before e2e."
    : overall === "medium"
      ? "Browser automation may be viable, but the agent should verify selectors against existing test conventions."
      : overall === "high"
        ? "Browser automation selectors look viable from captured evidence."
        : "No interaction selectors were captured; the agent must inspect the repo before choosing a browser test.";
  return {
    overall,
    analyzedEvents,
    blockers,
    guidance,
  };
}

function firstRunner(repo, names) {
  const runners = repo.testStack?.configuredRunners ?? repo.likelyTestCommands ?? [];
  return runners.find((runner) => names.some((name) => new RegExp(name, "i").test(`${runner.name} ${runner.command}`)));
}

function preferredTestRoot(repo, strategy) {
  const folders = repo.testFolders ?? [];
  if (strategy === "browser-e2e") return folders.find((folder) => /e2e|specs/i.test(folder)) ?? folders[0] ?? "e2e";
  return folders.find((folder) => /tests?|__tests__/i.test(folder)) ?? folders[0] ?? "tests";
}

function preferredExtension(repo) {
  const testFiles = repo.testStack?.testFiles ?? [];
  const sample = testFiles.find((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  if (sample) {
    const match = sample.match(/(\.(?:test|spec)\.[cm]?[jt]sx?)$/);
    if (match) return match[1];
  }
  if (repo.testStack?.frameworks?.includes("node-test")) return ".test.mjs";
  return ".test.js";
}

function commandForStrategy(repo, strategy) {
  const packageManager = repo.packageManager && repo.packageManager !== "unknown" ? repo.packageManager : "npm";
  const runner = strategy === "browser-e2e"
    ? firstRunner(repo, ["playwright", "cypress", "e2e"])
    : firstRunner(repo, ["jest", "vitest", "node --test", "^test$"]);
  if (runner) return `${packageManager} run ${runner.name}`;
  if (strategy === "browser-e2e" && repo.testStack?.frameworks?.includes("playwright")) return "npx playwright test";
  if (repo.testStack?.frameworks?.includes("jest")) return "npx jest";
  if (repo.testStack?.frameworks?.includes("vitest")) return "npx vitest run";
  if (repo.testStack?.frameworks?.includes("node-test")) return "node --test";
  return null;
}

export function coverageStrategy(session, index) {
  const repo = session.repo ?? {};
  const testStack = repo.testStack ?? {};
  const selectorAnalysis = selectorAutomationAnalysis(index);
  const frameworks = testStack.frameworks ?? [];
  const hasBrowserRunner = (testStack.browserE2EFrameworks ?? []).length > 0 || (repo.playwrightConfigs ?? []).length > 0;
  const hasUnitRunner = (testStack.unitIntegrationFrameworks ?? []).length > 0;
  let strategy = "manual-blocker";
  let label = "Needs repo inspection before test generation";
  let rationale = "Test Capture could not identify a configured test stack with enough confidence.";
  let proposedTestFile = null;

  if (hasBrowserRunner && selectorAnalysis.overall !== "low") {
    strategy = "browser-e2e";
    label = frameworks.includes("cypress") && !frameworks.includes("playwright") ? "Cypress browser e2e test" : "Playwright browser e2e test";
    rationale = "The repo has a configured browser e2e runner and captured selectors look viable enough for browser automation.";
  } else if (hasUnitRunner) {
    strategy = selectorAnalysis.overall === "low" ? "state-integration" : "integration";
    label = selectorAnalysis.overall === "low" ? "Repo-native state/integration test" : "Repo-native integration test";
    rationale = selectorAnalysis.overall === "low"
      ? "The repo has a unit/integration runner, while browser automation is weak from captured selectors."
      : "The repo already has a non-browser test runner and no configured browser e2e runner should be added by default.";
  } else if (hasBrowserRunner) {
    strategy = "manual-blocker";
    label = "Instrumentation needed before browser e2e";
    rationale = "The repo has a browser runner, but captured selectors are too weak for a maintainable browser test.";
  }

  const command = commandForStrategy(repo, strategy);
  if (strategy !== "manual-blocker") {
    const fileSlug = session.description
      ? session.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : session.id.toLowerCase();
    const root = preferredTestRoot(repo, strategy);
    const extension = strategy === "browser-e2e"
      ? (repo.testStack?.frameworks?.includes("playwright") ? ".spec.ts" : ".spec.js")
      : preferredExtension(repo);
    proposedTestFile = `${root}/${fileSlug || "captured-scenario"}${extension}`;
  }

  return {
    strategy,
    label,
    rationale,
    confidence: testStack.confidence ?? 0,
    command,
    proposedTestFile,
    selectorViability: selectorAnalysis.overall,
    selectorGuidance: selectorAnalysis.guidance,
    automationBlockers: selectorAnalysis.blockers,
    repoWarnings: testStack.policyWarnings ?? [],
  };
}

export function testabilityFindings(index) {
  const findings = new Map();
  for (const candidate of index.selectorCandidates) {
    if (candidate.quality === "brittle") {
      addFinding(findings, {
        key: `selector:brittle:${candidate.selector}`,
        severity: "medium",
        title: "Brittle selector candidate",
        detail: `Selector \`${candidate.selector}\` may be coupled to DOM structure or generated styling.`,
        suggestedFix: "Prefer a role, label, text, or stable data-testid selector.",
        selector: candidate.selector,
      });
    }
  }
  for (const event of index.events) {
    const eventId = event.id ? [event.id] : [];
    if (event.type === "input" && !event.label) {
      addFinding(findings, {
        key: `input:missing-label:${event.selector || "unknown"}`,
        severity: "high",
        title: "Input has no accessible label",
        detail: `Input selector \`${event.selector || "unknown"}\` had no label during capture.`,
        suggestedFix: "Add a visible label, aria-label, or label[for] association before relying on this field in generated tests.",
        selector: event.selector,
        sampleEventIds: eventId,
      });
    }
    if (event.type === "input" && ["placeholder", "name", "none"].includes(event.labelSource)) {
      addFinding(findings, {
        key: `input:weak-label:${event.selector || "unknown"}:${event.labelSource || "fallback"}`,
        severity: event.labelSource === "placeholder" ? "medium" : "high",
        title: "Input relies on weak selector text",
        detail: `Input selector \`${event.selector || "unknown"}\` used ${event.labelSource || "fallback"} text instead of an accessible label.`,
        suggestedFix: "Add a proper accessible label and keep placeholder text as a hint only.",
        selector: event.selector,
        sampleEventIds: eventId,
      });
    }
    if (event.type === "click" && !event.label && event.selector) {
      const isCanvas = /canvas/i.test(event.selector);
      const isSvg = /svg/i.test(event.selector);
      addFinding(findings, {
        key: `click:missing-name:${event.selector}`,
        severity: isCanvas ? "high" : "medium",
        title: isCanvas ? "Canvas target blocks stable browser automation" : "Click target has no accessible name",
        detail: `Click target \`${event.selector}\` had no accessible name during capture.`,
        suggestedFix: isCanvas
          ? "Test the graph/domain state directly, or expose stable instrumentation before relying on e2e clicks."
          : isSvg
            ? "Add an accessible name or click a named parent control before relying on this target in generated tests."
            : "Add visible text, aria-label, or a stable test id with a documented reason.",
        selector: event.selector,
        sampleEventIds: eventId,
      });
    }
  }
  if (index.network.some((event) => event.status >= 400 || event.status === 0)) {
    const failing = index.network.filter((event) => event.status >= 400 || event.status === 0);
    addFinding(findings, {
      key: "network:failing-responses",
      severity: failing.some((event) => event.status >= 500 || event.status === 0) ? "high" : "medium",
      title: "Failing network responses appeared",
      detail: `${failing.length} failing network response(s) appeared during capture.`,
      suggestedFix: "Classify whether these responses are expected setup noise before asserting the flow.",
      sampleEventIds: failing.map((event) => event.id).filter(Boolean).slice(0, 5),
    });
  }
  return [...findings.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.key.localeCompare(b.key));
}

export function classifyConsoleEvents(index) {
  const events = (index.console ?? []).map((event) => {
    const message = event.message || "";
    let classification = "normal";
    let severity = "info";
    let expected = true;
    let reason = "Console event is informational.";
    if (/React Router Future Flag Warning/i.test(message)) {
      classification = "known-framework-warning";
      reason = "Known React Router future-flag warning; useful to report but not a product failure.";
    } else if (event.type === "error" && /\b404\b|not found/i.test(message)) {
      classification = "network-404";
      severity = "medium";
      expected = false;
      reason = "Browser console reported a 404 or missing resource.";
    } else if (event.type === "error") {
      classification = "unexpected-error";
      severity = "high";
      expected = false;
      reason = "Unexpected console error.";
    } else if (["warning", "warn"].includes(event.type)) {
      classification = "unexpected-warning";
      severity = "medium";
      expected = false;
      reason = "Unexpected console warning.";
    }
    return { ...event, classification, severity, expected, reason };
  });
  return {
    total: events.length,
    unexpectedCount: events.filter((event) => !event.expected).length,
    events,
  };
}

export function classifyNetworkEvents(index) {
  const targetOrigin = urlInfo(index.target).origin;
  const events = (index.network ?? []).map((event) => {
    const info = networkCategory(event, targetOrigin);
    return {
      ...event,
      endpoint: info.endpoint,
      category: info.category,
      statusFamily: statusFamily(event.status),
      appRelevant: ["app-api", "app"].includes(info.category),
    };
  });
  return {
    total: events.length,
    appRelevantCount: events.filter((event) => event.appRelevant).length,
    failingCount: events.filter((event) => ["failed", "client-error", "server-error"].includes(event.statusFamily)).length,
    events,
  };
}

export function summarizeEvents(index) {
  const evidence = intentEvidence(index);
  return {
    totalEvents: index.events.length,
    fields: evidence.fields,
    actions: evidence.actions,
    networkOutcomes: evidence.network.filter((event) => event.status >= 200 && event.status < 300),
    visibleText: evidence.visibleText,
    markers: evidence.markers,
  };
}

export function buildSessionSummaries(session, index) {
  const network = classifyNetworkEvents(index);
  const console = classifyConsoleEvents(index);
  const testability = testabilityFindings(index);
  const eventSummary = summarizeEvents(index);
  const automation = selectorAutomationAnalysis(index);
  const strategy = coverageStrategy(session, index);
  return {
    eventSummary,
    networkSummary: network,
    consoleSummary: console,
    testabilitySummary: {
      total: testability.length,
      highCount: testability.filter((finding) => finding.severity === "high").length,
      mediumCount: testability.filter((finding) => finding.severity === "medium").length,
      automationViability: automation.overall,
      automationBlockers: automation.blockers,
      findings: testability,
    },
    coverageStrategy: strategy,
    report: {
      sessionId: session.id,
      state: session.state,
      target: session.target,
      description: session.description,
      health: {
        privacySafeByDefault: !session.privacy?.allowTrace && !session.privacy?.preserveProfile,
        unexpectedConsoleEvents: console.unexpectedCount,
        failingNetworkEvents: network.failingCount,
        testabilityFindings: testability.length,
        automationViability: automation.overall,
      },
      nextActions: [
        ...(scenarioMismatchWarnings(session, index).length ? ["Resolve scenario/behavior mismatch before generating tests."] : []),
        ...(automation.blockers.length ? ["Treat selector automation blockers as coverage strategy input before generating browser tests."] : []),
        ...(testability.length ? ["Review deduped testability findings and fix high-severity accessibility gaps."] : []),
        ...(console.unexpectedCount ? ["Classify or fix unexpected console errors/warnings."] : []),
        ...(network.failingCount ? ["Review failing network events before asserting the flow."] : []),
      ],
    },
  };
}

function flakeRisks(index) {
  const risks = [];
  if (index.selectorCandidates.some((candidate) => candidate.quality === "brittle")) {
    risks.push("brittle selector candidates were observed; prefer role, label, text, or test-id selectors");
  }
  if (index.network.some((event) => event.status >= 500)) {
    risks.push("server error responses appeared during capture");
  }
  if (index.events.some((event) => /timeout|animation|loading/i.test(event.label ?? ""))) {
    risks.push("transient loading or animation state may need explicit waiting");
  }
  return risks;
}

export function draftScenario(session, index) {
  const assertions = assertionCandidates(index);
  const risks = flakeRisks(index);
  const mismatches = scenarioMismatchWarnings(session, index);
  return `# Scenario

Provenance: ${provenance.agentAuthored}
Source session: ${session.id}

## Summary

${title(session.description)}

## Preconditions

- Target URL: ${session.target}
- Repository branch: ${session.repo.branch}
- The coding agent must verify repo fixtures, auth setup, and selector conventions before writing tests.

## Behavior Observed

${mainBehavior(index)}

## Intent Warnings

${mismatches.length ? mismatches.map((item) => `- ${item}`).join("\n") : "- No scenario/behavior mismatch was detected from the available evidence."}

## Suggested Assertions

${assertions.length ? assertions.map((item) => `- [${item.id}] ${item.text}`).join("\n") : "- No assertion candidates are available until more behavior is captured."}

## Flake Risks

${risks.length ? risks.map((item) => `- ${item}`).join("\n") : "- No deterministic flake risks were detected from the available evidence."}

## Open Questions

${index.uncertainties.length ? index.uncertainties.map((item) => `- ${item}`).join("\n") : "- Developer should confirm which observed behavior is the business-critical assertion."}
`;
}

export function draftCoveragePlan(session, index) {
  const assertions = assertionCandidates(index);
  const strategy = coverageStrategy(session, index);
  const repo = session.repo ?? {};
  const testStack = repo.testStack ?? {};
  return `# Coverage Plan

Provenance: ${provenance.agentAuthored}
Source session: ${session.id}

## Recommended Test Strategy

- Strategy: ${strategy.label}
- Strategy ID: ${strategy.strategy}
- Confidence: ${Math.round(strategy.confidence * 100)}%
- Reason: ${strategy.rationale}
- Browser automation viability: ${strategy.selectorViability}. ${strategy.selectorGuidance}
- Recommended command: ${strategy.command || "blocked until the agent confirms the repo test command"}

## Repo Constraints

- Detected frameworks: ${(testStack.frameworks ?? ["unknown"]).join(", ")}
- Browser e2e runners: ${(testStack.browserE2EFrameworks ?? []).join(", ") || "none detected"}
- Unit/integration runners: ${(testStack.unitIntegrationFrameworks ?? []).join(", ") || "none detected"}
- Config files: ${(testStack.configFiles ?? []).join(", ") || "none detected"}
- Existing test folders: ${(repo.testFolders ?? []).join(", ") || "not detected"}
- Existing test files sampled: ${(testStack.testFiles ?? []).slice(0, 8).join(", ") || "none detected"}
- Policy warnings: ${(strategy.repoWarnings ?? []).join("; ") || "none"}

## Automation Viability

${strategy.automationBlockers.length
    ? strategy.automationBlockers.map((item) => `- [BLOCKER] ${item.reason}${item.selector ? ` (${item.selector})` : ""}. Fix: ${item.suggestedFix}`).join("\n")
    : "- No selector automation blockers were detected from captured interactions."}

## Proposed Test File

- ${strategy.proposedTestFile || "BLOCKED: inspect repo conventions before choosing a file"}

## Test Shape

- Use the recommended strategy above; do not add a new test runner just because the flow was captured in a browser.
- Start with one focused test for the confirmed scenario.
- Split only if the developer marked setup, bug reproduction, or persistence as separate concerns.
- If browser automation viability is low, prefer state, model, reducer, service, or component-boundary coverage over brittle e2e clicks.

## Assertions To Include

${assertions.length ? assertions.map((item) => `- [${item.id}] ${item.text}`).join("\n") : "- Block test generation until the developer confirms at least one expected result."}

## Intent Warnings

${scenarioMismatchWarnings(session, index).length ? scenarioMismatchWarnings(session, index).map((item) => `- ${item}`).join("\n") : "- No scenario/behavior mismatch was detected from the available evidence."}

## Setup And Fixtures To Inspect

- Existing tests matching the recommended strategy.
- Helpers, fixtures, reducers, services, or state synchronization seams near the affected feature.
- Browser e2e config only if a browser runner is already configured.
- Auth and fixture helpers near the proposed test folder.

## Allowed Deviations

- Use an existing repo helper path or consolidated test file if it better matches local conventions.
- Write a lower-level test when selector automation viability is low.
- Do not add Playwright, Cypress, or another new runner without explicit maintainer approval.
- If the linked test file or strategy differs from this plan, pass a deviation reason when linking the test.

## Do Not Test

- Do not encode every raw click as test code.
- Do not assert screenshots, dynamic ids, generated CSS chains, or transient loading text unless explicitly approved.
- Do not persist secrets or raw typed values in test fixtures.
- Do not follow the proposed file path blindly if repo inspection shows a better existing convention.

## Known Flake Risks

${flakeRisks(index).length ? flakeRisks(index).map((item) => `- ${item}`).join("\n") : "- None detected from available evidence."}

## Blocking Questions

${[
    assertions.length ? "Confirm this coverage plan before generating or linking tests." : "What exact outcome should the generated test assert?",
    ...(strategy.strategy === "manual-blocker" ? ["Which existing test runner and file convention should the agent use?"] : []),
    ...(strategy.automationBlockers.length ? ["Should the agent write lower-level coverage now, or should the app expose stable instrumentation first?"] : []),
  ].map((item) => `- ${item}`).join("\n")}
`;
}

export function draftTestability(index) {
  const findings = testabilityFindings(index);
  return `# Testability Findings

Provenance: ${provenance.toolGenerated}

${findings.length ? findings.map((finding) => `- [${finding.severity.toUpperCase()}] ${finding.title} (${finding.count}x): ${finding.detail} Fix: ${finding.suggestedFix}${finding.sampleEventIds.length ? ` Samples: ${finding.sampleEventIds.join(", ")}` : ""}`).join("\n") : "- No testability warnings were detected from the available evidence."}
`;
}

export function draftReport(session, index) {
  const summaries = buildSessionSummaries(session, index);
  return `# Test Capture Report

Provenance: ${provenance.toolGenerated}
Source session: ${session.id}

## Status

- State: ${session.state}
- Target: ${session.target}
- Description: ${title(session.description)}

## Signal

- UI events: ${summaries.eventSummary.totalEvents}
- App-relevant network events: ${summaries.networkSummary.appRelevantCount}/${summaries.networkSummary.total}
- Unexpected console events: ${summaries.consoleSummary.unexpectedCount}/${summaries.consoleSummary.total}
- Testability findings: ${summaries.testabilitySummary.total}

## Next Actions

${summaries.report.nextActions.length ? summaries.report.nextActions.map((item) => `- ${item}`).join("\n") : "- No blocking follow-up detected from summaries."}
`;
}

export function draftAgentContext(session, index) {
  return `# Agent Context

Provenance: ${provenance.agentAuthored}
Source session: ${session.id}

## What Happened

${title(session.description)}

The agent-safe index contains ${index.events.length} UI events, ${index.network.length} network events, ${index.console.length} console events, and ${index.screenshots.length} screenshot references.

## Evidence

- Session metadata: session.json
- Agent-safe index: agent-safe-index.json
- Scenario draft: scenario.md
- Coverage plan: coverage-plan.md
- Testability findings: testability.md
- Event summary: event-summary.json
- Network summary: network-summary.json
- Console summary: console-summary.json
- Final report: report.md
- Screenshots directory: screenshots/
- Trace archive: trace.zip, when Playwright trace capture is available

## Guidance For The Coding Agent

- Verify the repository's existing test style before editing tests.
- Use confirmed intent and stable selectors, not a literal recording of every click.
- Keep secrets out of generated tests and fixtures.
- Ask for clarification before generating a test if the coverage plan has blocking questions.
- Run the narrowest relevant test command first, then update the ledger only after the test passes.

## Repo Signals

\`\`\`json
${JSON.stringify(session.repo, null, 2)}
\`\`\`
`;
}
