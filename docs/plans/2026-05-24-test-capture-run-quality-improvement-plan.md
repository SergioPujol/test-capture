<!-- autoplan restore point unavailable: source was the latest Test Capture run review in chat, not an existing plan file. -->

# Plan: Test Capture Run Quality Improvements

Date: 2026-05-24
Branch: main
Repo: test-capture
Source session: 127-0-0-1-2026-05-24T14-14-18-720Z
Status: PROPOSED

## Problem

The latest dogfood run completed and linked a passing test, but the product result is not good enough to leave alone.

The issue is not that the generated test failed. The issue is more dangerous: Test Capture can say a session is verified while its artifacts still contain raw sensitive values, its scenario and coverage plan describe the wrong intent, and its reports bury useful findings in duplicated noise.

For this product, privacy trust and "passing test means the right thing was tested" are core promises. This plan fixes those first.

## Premises

1. Strict privacy mode must mean no persisted raw typed text, tokens, passwords, or secret-like query values in normal session artifacts.
2. `agent-safe-index.json`, `capture-buffer.json`, markdown artifacts, and linked metadata must agree on privacy and state semantics.
3. Scenario and coverage generation should summarize intent-level facts, not every low-level click or keystroke.
4. A generated test can pass and still be wrong if it does not implement the approved scenario and coverage plan.
5. Heavy debugging artifacts are useful, but they should not be part of the normal agent handoff unless explicitly requested.
6. Testability and console findings should be grouped, classified, and actionable enough that developers trust them.

## Review Summary

CEO review:

- P0 privacy trust is the product. Raw `capture-buffer.json`, screenshots, trace snapshots, and browser profile files can persist sensitive values.
- P0 the test loop produced "passing but wrong" risk: the scenario said billing email save, while the flow was billing privacy/redaction.
- P1 coverage plans must become contracts, not loose suggestions.
- P1 artifact noise will make agents and developers ignore useful evidence.

Engineering review:

- P0 raw capture data is persisted before redaction in `src/recorder.mjs` and `src/session-store.mjs`.
- P0 privacy summary keys are inconsistent with session privacy keys, so screenshot safety metadata can be wrong.
- P1 scenario generation reads raw event order and misses the submit/success outcome.
- P1 link-test metadata is too weak to prove coverage alignment.
- P1 state transitions are not transactional around privacy-critical writes.

DX review:

- The default reports are too broad and too noisy for a developer trying to create a maintainable test.
- Network and console output need curated summaries.
- `doctor`, `list-sessions`, and post-capture output should point to the exact next action.
- Browser profiles and stale sessions need explicit cleanup and size visibility.

## Scope

In scope:

- Privacy write boundary and artifact leak prevention.
- Scenario and coverage generation quality.
- Testability finding dedupe and severity.
- Console and network classification summaries.
- Link-test metadata and coverage alignment.
- Session artifact slimming and cleanup ergonomics.
- Focused regression tests for the latest dogfood failure modes.

Out of scope:

- Building a full automated test generator.
- Adding Jira, Linear, or GitHub integrations.
- Replacing Playwright.
- Solving screenshot pixel redaction in V1. Screenshots can remain opt-in and marked sensitive while text artifacts are made safe.
- A hosted UI or cloud artifact sync.

## What Already Exists

| Need | Existing code | Current gap |
|---|---|---|
| Capture browser events | `src/recorder.mjs` | Records raw input values and persists the browser profile under the session directory. |
| Redaction primitives | `src/privacy.mjs` | Used for the agent-safe index, but not at the durable raw buffer write boundary. |
| Session writes | `src/session-store.mjs` | Writes JSON directly, without sanitizing capture buffers or atomic privacy validation. |
| Agent-safe index | `src/indexer.mjs` | Redacts values, but state and privacy summaries can be stale or misleading. |
| Scenario and coverage drafts | `src/artifacts.mjs` | Uses raw event order and generic assertion candidates. |
| Testability findings | `src/artifacts.mjs` | Emits duplicate findings per keystroke. |
| Link-test workflow | `src/operations.mjs`, `src/ledger.mjs` | Checks file existence and status only, not alignment with approved coverage. |
| CLI | `src/cli.mjs` | Has raw `network` and `selectors`, but lacks curated `report`, `console`, and compact lifecycle output. |

## Architecture Target

```
Browser events
  |
  v
in-memory raw capture
  |
  v
sanitizeCaptureForPersistence(session, capture)
  |              \
  |               -> privacy leak validator
  v
persisted capture-buffer.json
  |
  v
buildAgentSafeIndex(session, sanitizedCapture)
  |
  +--> event-summary.json
  +--> network-summary.json
  +--> console-summary.json
  +--> scenario.md
  +--> coverage-plan.md
  +--> testability.md
  |
  v
link-test verifies coverage plan alignment before VERIFIED
```

The key change is a single durable-write boundary. Raw capture data may exist in memory during capture, but the default persisted session bundle must be sanitized before any state advances.

## Phase 1: Privacy And Artifact Safety

Priority: P0

Files:

- `src/privacy.mjs`
- `src/recorder.mjs`
- `src/session-store.mjs`
- `src/indexer.mjs`
- `tests/privacy.test.mjs`
- `tests/session-store.test.mjs`
- new `tests/artifact-privacy.test.mjs` if needed

Tasks:

1. Add `sanitizeCaptureForPersistence(session, capture)` in `src/privacy.mjs` or a new `src/capture-sanitizer.mjs`.
2. Apply the sanitizer before `writeCaptureBuffer` in both interactive and scripted capture paths.
3. Guarantee secret-like fields stay redacted even when typed text is explicitly allowed.
4. Normalize privacy summary inputs so `redactionSummary` uses `allowScreenshots`, `allowNetworkBodies`, and `allowTypedText` correctly.
5. Mark screenshots as sensitive when screenshots are enabled. Do not claim screenshots are safe just because text values are masked.
6. Disable Playwright trace snapshots by default, or add an explicit `--trace`/privacy opt-in. The current trace can contain DOM snapshots with raw values.
7. Move or delete Chromium `browser-profile/` after capture by default. If auth persistence needs it, keep only an explicit storage-state artifact or preserve the profile behind an opt-in flag.
8. Add a session artifact leak test that scans persisted JSON and markdown artifacts for known raw values from a fixture capture.

Acceptance criteria:

- With default privacy settings, `capture-buffer.json` contains `[MASKED]` or `[REDACTED]`, not raw email, memo, reimbursement code, access token, or secret query values.
- `agent-safe-index.json` and `capture-buffer.json` agree on redacted network URLs.
- `redaction.screenshotsMayContainSensitiveData` is true when screenshots are enabled.
- Normal capture does not leave a 12 MB Chromium profile inside the session directory.
- Tests fail if any persisted default artifact contains `token=1234`, `admin@northstar`, `private test`, or `reimbursement-code-test`.

Risks:

- Removing persistent profiles may affect auth-heavy local apps. Mitigation: add a named opt-in such as `--preserve-profile` and document the privacy tradeoff.
- Disabling trace snapshots reduces debug depth. Mitigation: keep trace opt-in for explicit debugging sessions.

## Phase 2: Intent Reconciliation And Coverage Contracts

Priority: P0/P1

Files:

- `src/artifacts.mjs`
- `src/agent-tools.mjs`
- `src/operations.mjs`
- `src/ledger.mjs`
- `tests/operations.test.mjs`
- new scenario/coverage unit tests

Tasks:

1. Add an intent reducer that collapses raw events into semantic facts:
   - route/navigation
   - final value-bearing interaction per field, redacted
   - submit/action click
   - app API calls
   - UI success/error text
   - human markers
   - setup/ignore/assert/persist/split markers
2. Update `draftScenario` to summarize the full flow, including submit and observed outcome, not only the first eight interactions.
3. Update `assertionCandidates` so it prefers durable outcomes:
   - expected app API request and status
   - visible success or error text
   - persistence/reload marker
   - explicit human `assert` marker
4. Stop proposing assertions that a password, token, or private memo "accepts the expected value" unless a human explicitly marked that field as the assertion.
5. Add a scenario mismatch warning when session description, observed route/actions, and outcome do not line up. Example: description says "save billing email" but evidence shows "submit sensitive flow".
6. Give coverage plan assertions stable IDs.
7. Store coverage plan hash and assertion IDs in link metadata.
8. On `link-test`, require one of:
   - linked file matches the approved proposed file, or
   - caller supplies a deviation reason.
9. Preserve multiple generated test links as objects instead of replacing with a single path string.

Acceptance criteria:

- The latest-style billing privacy capture produces a scenario centered on Billing -> sensitive fields -> Submit sensitive flow -> `POST /api/login` -> redacted private endpoint -> success toast.
- A scenario named "Customer can save billing email" with no customer save request gets a blocking mismatch warning.
- Coverage plan contains concrete assertions such as `POST /api/login returns 200` and `Sensitive flow completed is visible`.
- `link-test` records coverage plan hash, assertion IDs, command, status, and verification timestamp.
- Linking a different file than the approved plan requires an explicit deviation reason.

Risks:

- Intent inference can become clever and wrong. Mitigation: keep the reducer explicit and evidence-based; when confidence is low, block generation with an open question.

## Phase 3: Testability, Console, And Network Signal

Priority: P1

Files:

- `src/artifacts.mjs`
- `src/indexer.mjs`
- `src/agent-tools.mjs`
- `src/cli.mjs`
- tests for artifact summaries and CLI output

Tasks:

1. Dedupe testability findings by stable key:
   - selector
   - issue type
   - label source
   - event type
2. Add severity, occurrence count, sample event IDs, and suggested fix to each finding.
3. Keep placeholder-label findings and no-accessible-name SVG findings separate.
4. Add console classification:
   - known framework/dev-server noise
   - app warning
   - app error
   - resource failure
   - browser advisory
5. Add network classification:
   - app/API requests
   - static assets
   - Vite/dev-server traffic
   - failed requests
   - secret-bearing URLs after redaction
6. Write `console-summary.json`, `network-summary.json`, and `event-summary.json`.
7. Add CLI commands or flags:
   - `console <session-id>`
   - `network <session-id> --app-only`
   - `report <session-id>`

Acceptance criteria:

- `testability.md` contains one reimbursement-code finding with a count, not 25 duplicate lines.
- The SVG click target is reported once with a suggested fix: click the accessible parent button or add an accessible name.
- `network --app-only` hides Vite/module traffic and shows `POST /api/login` plus the redacted private endpoint.
- Console summary distinguishes React Router future warnings from unexpected app errors.
- Coverage plans can reference the console allowlist instead of a vague "known issues are reviewed" statement.

Risks:

- Hardcoded framework warning rules may age poorly. Mitigation: keep a small default classifier plus user-visible allowlist output.

## Phase 4: Session Lifecycle And Developer Experience

Priority: P1/P2

Files:

- `src/cli.mjs`
- `src/session-store.mjs`
- `src/operations.mjs`
- `README.md`
- `examples/capture-target/README.md`
- CLI tests if command-level tests are added

Tasks:

1. Add a one-screen final capture report after `start`, `stop`, and `scripted-capture`:
   - session ID
   - state
   - artifact path
   - meaningful actions
   - app/API requests
   - console summary
   - testability summary
   - generation blockers
   - exact next command
2. Make `doctor` human-readable by default and keep JSON behind `--json`.
3. Add `list-sessions --compact` with stale `RECORDING` session warnings.
4. Add cleanup commands:
   - `clean --stale`
   - `clean --profiles`
   - `clean --session <id> --yes`
5. Add session size reporting so large artifacts are visible.
6. Update docs to explain strict privacy, screenshots, traces, profiles, and the difference between raw debug artifacts and agent-safe artifacts.

Acceptance criteria:

- A dogfood capture ends with a concise report that points to the next command.
- `list-sessions --compact` clearly shows stale sessions and their likely cleanup action.
- `doctor` tells the developer "ready to capture" or lists exact fixes.
- Docs tell users what is persisted by default and which flags increase privacy risk.

Risks:

- More CLI surface can slow V1. Mitigation: implement `report`, `console`, and `network --app-only` first; defer cleanup variants if needed.

## Test Plan

Unit tests:

- `redactValue` and `redactEvent` preserve strict secret redaction under every privacy option.
- `sanitizeCaptureForPersistence` masks typed text and redacts secret URLs before write.
- `redactionSummary` maps session privacy keys correctly.
- `draftTestability` dedupes repeated placeholder findings.
- Scenario reducer collapses repeated input events and includes submit/outcome events.
- Coverage plan emits assertion IDs and concrete outcome assertions.
- `linkGeneratedTest` rejects invalid status, records coverage metadata, and requires deviation reason for mismatched files.

Integration tests:

- Scripted capture of the billing privacy flow with known raw values.
- Scan persisted default artifacts for raw sensitive strings.
- Verify app-only network summary contains only meaningful requests.
- Verify console summary buckets React Router warnings separately from unexpected errors.
- Verify final report output includes blockers and next command.

Dogfood test:

1. Run the capture target.
2. Capture the billing privacy flow with screenshots enabled.
3. Generate scenario and coverage plan.
4. Confirm no default persisted JSON or markdown artifact contains raw typed text or token query values.
5. Confirm `testability.md` has grouped findings.
6. Link a generated test only after coverage assertion IDs are recorded.
7. Run `CAPTURE_TARGET_BASE_URL=http://127.0.0.1:5174/ npm test`.

## Failure Modes Registry

| Failure mode | Severity | Mitigation |
|---|---:|---|
| Raw secret persists in `capture-buffer.json` | Critical | Sanitize before durable write; leak scanner test. |
| Trace or screenshot contains sensitive value | High | Trace opt-in; screenshots marked sensitive; docs warn explicitly. |
| Session marked verified but index state remains stale | High | Refresh metadata on state transition or split evidence state from live status. |
| Generated test passes but implements wrong scenario | Critical | Intent reconciliation gate and coverage assertion IDs. |
| Testability report repeats the same issue per keystroke | Medium | Finding-key aggregation. |
| Network output hides app signal behind dev-server noise | Medium | App-only summaries and CLI filtering. |
| Console assertion fails on known framework warnings | Medium | Console classifier and allowlist in coverage plan. |
| Profile cleanup breaks authenticated local flows | Medium | Explicit `--preserve-profile` opt-in and storage-state alternative. |

## Implementation Order

1. Privacy write boundary and leak tests.
2. Privacy metadata consistency and state/index refresh decision.
3. Intent reducer and scenario/coverage rewrite.
4. Link-test coverage metadata and deviation handling.
5. Testability dedupe.
6. Network and console summaries.
7. Final report and compact lifecycle CLI.
8. Docs update and full dogfood run.

Do not start with CLI polish. The first implementation slice must close the privacy leak and wrong-test risk.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Prioritize privacy write-boundary before report polish | Mechanical | Choose completeness | Privacy trust is the product promise and current artifacts contradict strict mode. | Starting with CLI/DX cleanup |
| 2 | CEO | Add intent reconciliation gate | Mechanical | Bias toward action | A passing but wrong test is worse than no generated test because it creates false confidence. | Treat generated test pass as sufficient |
| 3 | Eng | Sanitize before durable write, not only in agent-safe index | Mechanical | Explicit over clever | A single write boundary is easier to audit than scattered redaction after persistence. | Redact only when agents read artifacts |
| 4 | Eng | Disable or opt into trace snapshots | Taste | Pragmatic | Trace snapshots are useful but can persist sensitive DOM values; default should favor privacy. | Always capture full trace snapshots |
| 5 | Eng | Require deviation metadata when linked file differs from coverage plan | Mechanical | Explicit over clever | It keeps repo-convention flexibility while preserving auditability. | Hard fail every mismatched path |
| 6 | DX | Add curated summaries instead of replacing raw index | Mechanical | DRY | Agents still need full structured evidence, but humans need a small default report. | Remove raw evidence entirely |
| 7 | DX | Group testability findings by root cause | Mechanical | Pragmatic | One actionable finding with count is more useful than repeated duplicate lines. | Keep per-event findings in markdown |

## GSTACK REVIEW REPORT

CEO score: 6/10 current behavior, 9/10 after this plan.

Engineering score: 5/10 current behavior, 8/10 after this plan.

DX score: 5/10 current behavior, 8/10 after this plan.

Cross-phase themes:

- Privacy and artifact safety were flagged by CEO, engineering, and DX.
- Intent mismatch and false verification were flagged by CEO and engineering.
- Artifact noise was flagged by all phases.
- Console/network classification was flagged by CEO and DX.

Final recommendation:

Approve this plan. Implement Phase 1 first and do not ship another dogfood capture as successful until the default artifact bundle is privacy-safe and the scenario/coverage/test link cannot silently disagree.
