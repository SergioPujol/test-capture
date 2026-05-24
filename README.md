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
node ./bin/test-capture.js summary <session-id>
node ./bin/test-capture.js coverage-plan <session-id>
node ./bin/test-capture.js testability <session-id>
```

The active coding agent should inspect the generated `agent-context.md`, confirm or edit the coverage plan with the developer, then write tests using the repository's existing conventions.
