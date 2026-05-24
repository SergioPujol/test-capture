import { provenance } from "./provenance.mjs";

function title(text) {
  return text?.trim() || "Captured browser verification";
}

function mainBehavior(index) {
  const meaningful = index.events.filter((event) => !["navigation", "load"].includes(event.type));
  if (meaningful.length === 0) return "No user behavior was captured yet.";
  return meaningful
    .slice(0, 8)
    .map((event) => {
      const target = event.label || event.role || event.selector || event.url || "unknown target";
      return `- ${event.type}: ${target}`;
    })
    .join("\n");
}

function assertionCandidates(index) {
  const candidates = [];
  if (index.network.some((event) => event.status >= 200 && event.status < 300)) {
    candidates.push("confirm the expected network request succeeds");
  }
  if (index.console.some((event) => ["error", "warning"].includes(event.type))) {
    candidates.push("assert the flow does not produce unexpected console errors after known issues are reviewed");
  }
  for (const event of index.events) {
    if (event.type === "click" && event.label) candidates.push(`assert the UI exposes "${event.label}" before interaction`);
    if (event.type === "input" && event.label) candidates.push(`assert "${event.label}" accepts the expected value without persisting the raw secret`);
  }
  return [...new Set(candidates)].slice(0, 10);
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

## Suggested Assertions

${assertions.length ? assertions.map((item) => `- ${item}`).join("\n") : "- No assertion candidates are available until more behavior is captured."}

## Flake Risks

${risks.length ? risks.map((item) => `- ${item}`).join("\n") : "- No deterministic flake risks were detected from the available evidence."}

## Open Questions

${index.uncertainties.length ? index.uncertainties.map((item) => `- ${item}`).join("\n") : "- Developer should confirm which observed behavior is the business-critical assertion."}
`;
}

export function draftCoveragePlan(session, index) {
  const assertions = assertionCandidates(index);
  const testRoot = session.repo.testFolders[0] ?? "e2e";
  const fileSlug = session.description
    ? session.description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : session.id.toLowerCase();
  const command = session.repo.likelyTestCommands[0]
    ? `${session.repo.packageManager} run ${session.repo.likelyTestCommands[0].name}`
    : "npx playwright test";
  return `# Coverage Plan

Provenance: ${provenance.agentAuthored}
Source session: ${session.id}

## Proposed Test File

- ${testRoot}/${fileSlug || "captured-scenario"}.spec.ts

## Test Shape

- Start with one end-to-end test for the confirmed scenario.
- Split only if the developer marked setup, bug reproduction, or persistence as separate concerns.

## Assertions To Include

${assertions.length ? assertions.map((item) => `- ${item}`).join("\n") : "- Block test generation until the developer confirms at least one expected result."}

## Setup And Fixtures To Inspect

- Playwright config: ${session.repo.playwrightConfigs.join(", ") || "not detected"}
- Existing test folders: ${session.repo.testFolders.join(", ") || "not detected"}
- Likely command: ${command}
- Auth and fixture helpers near the proposed test folder.

## Do Not Test

- Do not encode every raw click as test code.
- Do not assert screenshots, dynamic ids, generated CSS chains, or transient loading text unless explicitly approved.
- Do not persist secrets or raw typed values in test fixtures.

## Known Flake Risks

${flakeRisks(index).length ? flakeRisks(index).map((item) => `- ${item}`).join("\n") : "- None detected from available evidence."}

## Blocking Questions

${assertions.length ? "- Confirm this coverage plan before generating or linking tests." : "- What exact outcome should the generated test assert?"}
`;
}

export function draftTestability(index) {
  const findings = [];
  for (const candidate of index.selectorCandidates) {
    if (candidate.quality === "brittle") {
      findings.push(`- Brittle selector candidate: \`${candidate.selector}\`. Add an accessible name or stable test id.`);
    }
  }
  if (index.events.some((event) => event.type === "input" && !event.label)) {
    findings.push("- At least one input event lacked a label. Add an accessible label before relying on form selectors.");
  }
  for (const event of index.events) {
    if (event.type === "input" && ["placeholder", "name", "none"].includes(event.labelSource)) {
      findings.push(`- Input selector \`${event.selector || "unknown"}\` used ${event.labelSource || "fallback"} text instead of an accessible label.`);
    }
    if (event.type === "click" && !event.label && event.selector) {
      findings.push(`- Click target \`${event.selector}\` had no accessible name during capture.`);
    }
  }
  if (index.network.some((event) => event.status >= 400)) {
    findings.push("- Failing network responses appeared during capture. Review whether they are expected before asserting the flow.");
  }
  return `# Testability Findings

Provenance: ${provenance.toolGenerated}

${findings.length ? findings.join("\n") : "- No testability warnings were detected from the available evidence."}
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
