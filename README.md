# Test Capture

Test Capture is a local, agent-native workflow for turning a developer's manual browser verification into durable automated test context.

V1 provides:

- a CLI surface for starting and querying capture sessions
- local session artifacts under `.test-capture/sessions`
- strict privacy redaction defaults
- deterministic agent-safe indexes, coverage plans, testability findings, failure triage, and a local ledger
- dynamic Playwright capture when Playwright is available in the host project

Run:

```sh
node ./bin/test-capture.js doctor
node ./bin/test-capture.js start --url http://localhost:3000
node ./bin/test-capture.js scripted-capture --url http://localhost:3000 --script ./capture-flow.json --screenshots
node ./bin/test-capture.js summary <session-id>
node ./bin/test-capture.js coverage-plan <session-id>
node ./bin/test-capture.js testability <session-id>
```

From Codex, use the installed skill entry point:

```txt
/test-capture --url http://localhost:3000 --description "Customer can save billing email"
```

Codex should launch the capture browser, wait while you manually verify the feature, inspect the generated artifacts, create or update the test, run it, fix failures, and link the passing test to the local ledger.

The active coding agent should inspect the generated `agent-context.md`, confirm or edit the coverage plan with the developer, then write tests using the repository's existing conventions.

## Coverage strategy

Test Capture records browser evidence, but it should not force every capture into a
new Playwright test. The coverage plan is a strategy contract for the coding agent:

- it detects the host repo's test stack and configured runners
- it prefers existing Jest, Vitest, Node test, Playwright, or Cypress conventions
- it does not recommend adding a new browser runner by default
- it downgrades browser e2e recommendations when the main interaction target is
  canvas, raw SVG, an unnamed control, or a brittle selector
- it records deviation reasons when the final linked test differs from the
  approved plan

Do not add a new test runner just because Test Capture observed a browser flow.
Use the captured evidence to write the most maintainable repo-native test.
