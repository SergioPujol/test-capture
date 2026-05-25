# Plan: Repo-Adaptive Coverage Plans And Selector Reality

Date: 2026-05-24
Branch: main
Repo: test-capture
Source feedback: external dogfood feedback pasted in chat
Status: IMPLEMENTED

## Problem

The feedback says Test Capture was useful as evidence, but not reliable enough as a test-generation guide.

That is the right criticism. Test Capture captured the human flow and surfaced selector risk, but its coverage plan pointed the agent toward a Playwright-style `e2e/*.spec.ts` test even though the target repository was locked to Jest and had no Playwright config. The agent had to override the tool.

For an agent-native testing product, that is a product failure. The tool should not make the agent fight the repo. It should make the repo constraints obvious, recommend the maintainable test shape, and downgrade browser automation when selectors make it unstable.

## Premises

1. Test Capture is evidence and workflow structure first, not an automated Playwright-test generator.
2. A coverage plan must adapt to the host repository's existing test stack before suggesting a file path, runner, or test style.
3. Adding a new test runner is a product decision, not a default output of a capture session.
4. Browser evidence can justify a non-browser test when the repo's maintainable seam is lower in the stack.
5. Selector risk is not just a warning. It changes which test shape is credible.
6. Canvas-only, SVG-only, or unnamed interaction targets should be treated as automation blockers unless the app exposes stable hooks or domain state.

## CEO Review

### Strategic Judgment

Score: 7/10 current direction, 9/10 after this plan.

The product promise is not "record clicks and generate Playwright." The promise is "show the agent what happened so it can create durable coverage in this repo." The feedback proves the current plan generator still thinks like a recorder too often.

If this is not fixed, Test Capture will feel impressive in demos and unreliable in real repos. Developers will trust the trace, then ignore the generated coverage plan because it conflicts with their test stack. That is a bad trust pattern.

### What Already Works

| Product need | Evidence from feedback | Judgment |
|---|---|---|
| Capture human intent | It recorded URL, manual flow, selectors, network, and notes | Keep and strengthen |
| Audit trail | Session, generated test, command, and passing status were linked | Keep, but require strategy metadata |
| Testability signal | It surfaced `canvas` as the main automation target | Keep, but make it actionable |
| Direct test guidance | It proposed Playwright e2e despite Jest constraints | Must fix |

### Not In Scope

- Building a universal test generator.
- Adding Playwright to Jest-only repositories by default.
- Solving canvas automation for every graph library.
- Replacing the agent's engineering judgment.
- Editing the application to add test ids or accessibility hooks without explicit user approval.

### Product Decision

Coverage plans should stop being "the test we think you should write" and become "the evidence-to-test strategy contract."

That contract must say:

- what the repo appears to support,
- what test shape is recommended,
- why browser automation is or is not credible,
- which assertions are backed by capture evidence,
- which assertions require repo inspection,
- what deviation requires a human or agent explanation.

## Design Review

UI scope: skipped. This is a CLI and agent-output planning change, not an end-user interface change.

Output design still matters because agents read these artifacts. The coverage plan must be more scannable:

1. Start with `Recommended Test Strategy`.
2. Show `Repo Constraints` before `Proposed Test File`.
3. Show `Automation Viability` before selector candidates.
4. Split `Evidence` from `Suggested Implementation`.
5. Use blocker language when the tool lacks enough repo or selector confidence.

Bad output:

```txt
Proposed Test File
- e2e/customer-flow.spec.ts
```

Good output:

```txt
Recommended Test Strategy
- Strategy: Jest integration test
- Reason: Repository has Jest tests and no Playwright config.
- Browser automation viability: low, primary target is canvas with no accessible name.
- Do not add a Playwright e2e test unless the maintainer explicitly opts in.
```

## Engineering Review

Score: 6/10 current architecture, 8/10 after this plan.

The repo already has useful seams:

| Need | Existing code | Current gap |
|---|---|---|
| Repo detection | `src/repo.mjs` | Detects package manager, test folders, Playwright config, and scripts, but not test framework policy or runner confidence. |
| Coverage plan drafting | `src/artifacts.mjs` | Picks a path and command too early and still defaults toward e2e/Playwright style. |
| Link metadata | `src/operations.mjs` | Records coverage hash and assertion IDs, but not chosen test strategy or repo-policy deviation. |
| Selector findings | `src/artifacts.mjs` | Dedupe and severity exist, but findings do not drive automation viability or strategy selection. |
| Agent tools | `src/agent-tools.mjs` | Exposes selectors and coverage plan, but not a structured repo strategy object. |

### Target Architecture

```txt
capture evidence
  |
  v
agent-safe index
  |
  +--> selector automation analysis
  |
  +--> repo test stack analysis
  |
  v
coverage strategy resolver
  |
  +--> recommended test layer
  +--> proposed file only when confidence is high
  +--> runner command
  +--> blockers and deviation rules
  |
  v
coverage-plan.md
  |
  v
link-test records strategy + deviations + assertion ids
```

### Phase 1: Repo Test Stack Policy

Priority: P0

Files:

- `src/repo.mjs`
- `src/artifacts.mjs`
- `tests/operations.test.mjs`
- new `tests/repo-detection.test.mjs`

Tasks:

1. Extend repo detection with a `testStack` object:
   - frameworks: `jest`, `vitest`, `node-test`, `playwright`, `cypress`, `rtl`, `unknown`
   - configured runners from package scripts
   - config files found
   - test file patterns found
   - confidence score
   - policy warnings
2. Add a no-new-runner default: if no browser e2e runner is configured, do not propose a Playwright e2e file.
3. Detect Jest-only and Vitest-only repos from dependencies, scripts, config files, and existing test extensions.
4. Prefer existing test folders and naming conventions over generic `e2e/*.spec.ts`.
5. When confidence is low, emit a blocker instead of a fake precise path.

Acceptance criteria:

- In a Jest-only fixture with no Playwright config, `coverage-plan.md` recommends a Jest test and does not contain `e2e/*.spec.ts`.
- In a Playwright-configured fixture, `coverage-plan.md` can recommend an e2e spec with the existing command.
- In a repo with no recognizable tests, the plan says "repo test stack unknown" and asks the agent to inspect conventions before creating a file.
- The plan names the evidence behind its recommendation.

### Phase 2: Test Strategy Resolver

Priority: P0

Files:

- `src/artifacts.mjs`
- possible new `src/coverage-strategy.mjs`
- `src/operations.mjs`
- tests for coverage strategy

Tasks:

1. Add a resolver that chooses one of:
   - browser e2e test
   - component test
   - Jest/Vitest integration test
   - unit or reducer/state synchronization test
   - manual blocker, needs instrumentation first
2. Base the choice on repo stack, selector viability, network evidence, visible outcomes, and human markers.
3. Include a rationale in the coverage plan.
4. Include "why not e2e" when browser automation is rejected.
5. Store chosen strategy in approved coverage metadata.
6. Require `--deviation-reason` when `link-test` records a different strategy or file family.

Acceptance criteria:

- The feedback scenario produces: "Jest cross-boundary synchronization test" when repo constraints indicate Jest and browser selectors are weak.
- Browser e2e is only recommended when both repo support and selector viability are sufficient.
- `link-test` stores `strategy`, `runner`, `assertionIds`, `coveragePlanHash`, and `deviationReason`.
- A linked Playwright file against a Jest-only plan requires a deviation reason.

### Phase 3: Selector Automation Viability

Priority: P1

Files:

- `src/artifacts.mjs`
- `src/indexer.mjs`
- `src/agent-tools.mjs`
- tests for selector risk and canvas targets

Tasks:

1. Add selector viability scoring:
   - high: role, label, text, stable test id
   - medium: stable CSS or semantic parent
   - low: canvas, raw SVG, nth-child, generated class, unnamed target
2. Promote low viability from advisory text into coverage strategy input.
3. Add target-specific guidance:
   - canvas: test domain state, graph model, or expose test hooks
   - SVG with no name: add accessible name or click named parent
   - unlabeled inputs: add labels before browser-level tests
4. Add `automation-blockers` to `testability-summary.json`.
5. Add an agent tool response that separates selector candidates from automation blockers.

Acceptance criteria:

- A capture whose main interaction target is only `canvas` gets low browser automation viability.
- The coverage plan recommends state/model-level coverage or app instrumentation before e2e.
- `testability.md` explains the specific app change that would make the flow automatable.
- Selector findings remain advisory for app edits, but blocking for generated browser tests.

### Phase 4: Agent Handoff Contract

Priority: P1

Files:

- `src/artifacts.mjs`
- `src/agent-tools.mjs`
- `README.md`
- tests for markdown output

Tasks:

1. Add `Repo Constraints` and `Recommended Test Strategy` as required coverage plan sections.
2. Add `Agent Must Inspect` section for repo helpers, existing tests, and state boundaries.
3. Add `Allowed Deviations` section:
   - use existing test helper path
   - write lower-level test if selector viability is low
   - do not add a new runner without user approval
4. Update `agent-context.md` to tell agents not to blindly follow the proposed file or runner.
5. Document that Test Capture output is evidence plus a strategy recommendation, not an instruction to install Playwright.

Acceptance criteria:

- An agent reading only `agent-context.md` knows to inspect the repo test stack before writing code.
- `coverage-plan.md` can be approved even when the recommended output is not a Playwright e2e test.
- Docs explicitly say: "Do not add a new test runner just because Test Capture observed a browser flow."

## DX Review

Score: 6/10 current DX, 9/10 after this plan.

The current user experience is good at proving that something happened. It is weaker at telling the agent what to do next in the target repo.

The ideal developer experience:

1. Developer captures a manual browser flow.
2. Test Capture says: "I saw this behavior."
3. Test Capture says: "Your repo appears to use Jest, not Playwright."
4. Test Capture says: "Browser automation is weak because the main target is canvas."
5. Test Capture recommends a repo-native test shape.
6. Agent writes that test and links it with a clear deviation or strategy record.

### Developer Journey Map

| Stage | Current risk | Target behavior |
|---|---|---|
| Start capture | Tool does not know final test style yet | Capture starts without pretending it knows the answer |
| Stop capture | Evidence is available | Evidence and repo constraints are summarized together |
| Coverage plan | May suggest wrong runner or path | Recommends repo-native strategy with confidence |
| Selector review | Finds weak selectors | Converts selector weakness into strategy guidance |
| Agent writes test | Agent may override silently | Override is expected, recorded, and justified |
| Link test | Passing status can hide mismatch | Link includes strategy, assertion ids, command, and deviation |

### TTHW

Target time from capture completion to correct test strategy: under 2 minutes.

The fastest path is not more generation. It is a better first page in `coverage-plan.md`.

## Test Plan

Unit tests:

- `detectRepo` identifies Jest-only, Vitest-only, Playwright, Cypress, Node test, and unknown fixtures.
- Coverage strategy resolver rejects Playwright e2e when no browser runner is configured.
- Coverage strategy resolver downgrades browser e2e when primary selector viability is low.
- Canvas-only captures produce automation blockers.
- `linkGeneratedTest` records strategy metadata and requires deviations for mismatched strategy.

Integration tests:

- Fixture repo: Jest-only, no Playwright config, existing `tests/*.test.ts`.
- Fixture capture: diagram node selection and rename with primary target `canvas`.
- Expected plan: Jest/state synchronization test, no `e2e/*.spec.ts`, no `npx playwright test`.
- Fixture repo: Playwright configured with stable selectors.
- Expected plan: browser e2e spec with existing command.

Dogfood test:

1. Run a capture against the example app.
2. Run coverage planning in three fixture repos: Jest-only, Playwright, unknown.
3. Verify each plan changes strategy based on repo constraints.
4. Link a generated test with matching strategy.
5. Link a different strategy with `--deviation-reason` and verify the ledger records it.

## Failure Modes Registry

| Failure mode | Severity | Mitigation |
|---|---:|---|
| Coverage plan proposes Playwright in a Jest-only repo | Critical | Repo test stack policy and no-new-runner default. |
| Agent follows a precise but wrong proposed file | High | Emit blocker when confidence is low; require strategy metadata. |
| Canvas selector warning is ignored | High | Feed selector viability into strategy resolver. |
| Tool becomes too conservative and never recommends e2e | Medium | Allow e2e when repo support and selector viability are both strong. |
| Repo detection guesses wrong from one script name | Medium | Use multiple signals and show confidence plus evidence. |
| Agents treat Test Capture as authoritative over repo conventions | High | Update `agent-context.md` and coverage plan language. |

## Implementation Order

1. Add repo test stack detection and fixture tests.
2. Add coverage strategy resolver with no-new-runner default.
3. Update `coverage-plan.md` structure and assertions.
4. Add selector viability and automation blockers.
5. Extend link metadata with strategy and deviation checks.
6. Update agent context and README.
7. Dogfood with Jest-only, Playwright, and unknown fixture repos.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Treat wrong test runner guidance as a product failure, not a small artifact bug | Mechanical | Choose completeness | The product exists to help agents write maintainable tests in the actual repo. | Leave the agent to override plans manually |
| 2 | CEO | Do not add new test runners by default | Mechanical | Explicit over clever | Existing repo conventions should win unless the user explicitly wants a new runner. | Suggest Playwright for every browser capture |
| 3 | Eng | Add a coverage strategy resolver instead of patching file-path templates | Mechanical | DRY | Strategy selection is shared by coverage plans, agent context, and link metadata. | Inline more conditionals in markdown generation |
| 4 | Eng | Let weak selectors downgrade browser automation | Mechanical | Pragmatic | A canvas-only target can be useful evidence while still being a poor browser test target. | Keep selector risk as advisory only |
| 5 | DX | Put repo constraints before proposed test file | Mechanical | Explicit over clever | Agents need to see why a recommendation is valid before seeing where to write. | Keep `Proposed Test File` as the first decision |
| 6 | DX | Require deviation metadata for mismatched test strategy | Mechanical | Bias toward action | Deviations are allowed, but they must be visible in the audit trail. | Hard block all deviations |

## GSTACK REVIEW REPORT

CEO score: 7/10 current behavior, 9/10 after this plan.

Design: skipped, no UI scope.

Engineering score: 6/10 current behavior, 8/10 after this plan.

DX score: 6/10 current behavior, 9/10 after this plan.

Cross-phase themes:

- Repo conventions must dominate generated test style.
- Selector viability must affect test strategy, not just produce a warning.
- Coverage plans need to be contracts with rationale, confidence, and deviation rules.
- The agent remains responsible for engineering judgment, but Test Capture should stop pushing it toward the wrong default.

Final recommendation:

Approve this plan after the existing privacy and intent-safety work. The highest-leverage first slice is repo test stack detection plus the no-new-runner default. That directly fixes the feedback: useful capture evidence should lead to a Jest-compatible test recommendation when the repo is Jest-only, and canvas-only interactions should steer the agent toward state/model coverage or instrumentation rather than brittle browser automation.
