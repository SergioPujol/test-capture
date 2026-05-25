# Test Capture

![Test Capture turns manual browser verification into agent evidence and repo-native tests.](docs/assets/test-capture-hero.png)

Test Capture is an agent-native workflow for Codex: you manually verify a feature in a browser once, and Codex uses the captured evidence to write, run, fix, and link a maintainable test in your repository.

It is not a generic test recorder. It is the missing browser-evidence layer for coding agents.

## Use It With Codex

Start your app locally, then ask Codex from the target application repo:

```txt
/test-capture --url http://localhost:3000 --description "Customer can save billing email"
```

Codex should then run the full loop:

1. Launch the capture browser for your local app.
2. Wait while you manually click through and verify the feature.
3. Stop capture when you tell Codex `done`.
4. Inspect the captured browser evidence: actions, screenshots, console output, network calls, selectors, and human intent markers.
5. Confirm the scenario and coverage plan with you when needed.
6. Write or update the most maintainable repo-native test.
7. Run the relevant test command.
8. Fix generated-test failures.
9. Link the passing test back to the local Test Capture ledger.

Run Test Capture from the app repo you are testing, not from a separate scratch directory. The `.test-capture/` artifacts, coverage plan, and ledger are meant to live beside the code and tests they describe.

## What Codex Gets

Test Capture gives the agent structured local evidence instead of a vague prompt:

- captured browser actions and navigation
- screenshots and accessibility-oriented selector candidates
- redacted network and console summaries
- human markers for assertions, setup, ignored steps, and bugs
- repo test-stack detection
- coverage plans that prefer existing Jest, Vitest, Node test, Playwright, or Cypress conventions
- testability findings for brittle selectors, unnamed controls, canvas/SVG targets, timing risks, and noisy failures
- a local ledger connecting capture sessions to generated tests and latest verification status

The important part is that Codex should not translate clicks one-for-one into a brittle browser test. It should use the capture as evidence, inspect the repo, and choose the test shape that fits the project.

## Install For Local Development

```sh
git clone https://github.com/SergioPujol/test-capture.git
cd test-capture
npm install
npm test
```

The package requires Node.js 20 or newer. Playwright is an optional peer dependency for target projects, but this repo uses it for development and dogfood coverage.

## CLI Fallback

Codex is the intended interface, but every core operation is also available from the CLI:

```sh
node ./bin/test-capture.js doctor
node ./bin/test-capture.js start --url http://localhost:3000 --description "Customer can save billing email" --screenshots
node ./bin/test-capture.js summary <session-id>
node ./bin/test-capture.js selectors <session-id>
node ./bin/test-capture.js network <session-id>
node ./bin/test-capture.js testability <session-id>
node ./bin/test-capture.js approve-scenario <session-id>
node ./bin/test-capture.js coverage-plan <session-id>
node ./bin/test-capture.js approve-coverage-plan <session-id>
node ./bin/test-capture.js link-test <session-id> --file <test-file> --command "<test-command>" --status passing
```

For repeatable dogfood flows, use scripted capture:

```sh
node ./bin/test-capture.js scripted-capture --url http://localhost:3000 --script ./capture-flow.json --screenshots
```

## Privacy Model

Strict privacy is the default. Test Capture redacts cookies, authorization headers, tokens, passwords, API keys, secret-like query parameters, and typed values before writing normal persisted artifacts.

Screenshots are opt-in and marked as potentially sensitive. Request and response bodies are not persisted by default. Generated agent artifacts are designed to be useful without leaking raw credentials or private form input.

## Coverage Strategy

Test Capture records browser evidence, but it should not force every capture into a new Playwright test. The coverage plan is a strategy contract for the coding agent:

- detect the host repo's test stack and configured runners
- prefer existing test conventions over adding infrastructure
- recommend browser e2e only when it is credible and maintainable
- downgrade browser automation when the main interaction target is canvas, raw SVG, unnamed controls, or brittle selectors
- require deviation reasons when the final linked test differs from the approved plan

Use the captured evidence to write the most maintainable repo-native test.
