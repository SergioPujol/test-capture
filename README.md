# Test Capture

![Test Capture turns manual browser verification into agent evidence and repo-native tests.](docs/assets/test-capture-hero.png)

Test Capture is an agent-native workflow for Codex: you manually verify a feature in a browser once, and Codex uses the captured evidence to write, run, fix, and link a maintainable test in your repository.

It is not a generic test recorder. It is the missing browser-evidence layer for coding agents.

## Install

Test Capture is easiest to use as a Codex skill. Install it once on the machine where Codex runs:

```sh
git clone https://github.com/SergioPujol/test-capture.git
cd test-capture
npm install
npm run install:codex-skill
```

Then restart Codex or start a new thread. The `/test-capture` skill will be available from any application repository.

The package requires Node.js 20 or newer. The Codex skill install bundles the runner and Playwright dependencies into `~/.codex/skills/test-capture`, so the app being tested does not need to add Test Capture as a project dependency.

## First Run

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

If anything fails before the browser opens, run the setup check from the target app repo:

```sh
node ~/.codex/skills/test-capture/bin/test-capture.js doctor --url http://localhost:3000
```

`doctor` verifies the current repo, `.test-capture/` gitignore status, Playwright availability, Chromium launchability, and target URL reachability.

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

## Develop This Package

```sh
git clone https://github.com/SergioPujol/test-capture.git
cd test-capture
npm install
npm test
```

For dogfood testing, start the bundled fixture app:

```sh
npm run capture-target:install
npm run capture-target:dev
```

## CLI Fallback

Codex is the intended interface, but every core operation is also available from the CLI:

```sh
node ~/.codex/skills/test-capture/bin/test-capture.js doctor --url http://localhost:3000
node ~/.codex/skills/test-capture/bin/test-capture.js start --url http://localhost:3000 --description "Customer can save billing email" --screenshots
node ~/.codex/skills/test-capture/bin/test-capture.js summary <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js selectors <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js network <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js testability <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js evidence-pack <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js evidence-pack <session-id> --json
node ~/.codex/skills/test-capture/bin/test-capture.js test-outline <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js test-outline <session-id> --json
node ~/.codex/skills/test-capture/bin/test-capture.js evidence-add <session-id> --fact "Final screenshot shows expected value" --source screenshots/0002.png --classification observed
node ~/.codex/skills/test-capture/bin/test-capture.js evidence-approve <session-id> --fact-id <manual-fact-id>
node ~/.codex/skills/test-capture/bin/test-capture.js approve-scenario <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js coverage-plan <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js approve-coverage-plan <session-id>
node ~/.codex/skills/test-capture/bin/test-capture.js link-test <session-id> --file <test-file> --command "<test-command>" --status passing
```

When working inside this repository, use the local runner directly:

```sh
node ./bin/test-capture.js doctor --url http://localhost:3000
node ./bin/test-capture.js start --url http://localhost:3000 --description "Customer can save billing email" --screenshots
node ./bin/test-capture.js summary <session-id>
node ./bin/test-capture.js selectors <session-id>
node ./bin/test-capture.js network <session-id>
node ./bin/test-capture.js testability <session-id>
node ./bin/test-capture.js evidence-pack <session-id>
node ./bin/test-capture.js evidence-pack <session-id> --json
node ./bin/test-capture.js test-outline <session-id>
node ./bin/test-capture.js test-outline <session-id> --json
node ./bin/test-capture.js evidence-add <session-id> --fact "Final screenshot shows expected value" --source screenshots/0002.png --classification observed
node ./bin/test-capture.js evidence-approve <session-id> --fact-id <manual-fact-id>
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
- require linked tests to account for evidence-pack facts, including observed domain values and any substituted mechanics

Use `evidence-pack` and `test-outline` before writing tests. The evidence pack is the source of truth for ids, field values, assertions, and selector recommendations. The test outline is the contract: required assertions, allowed mechanics, recommended locators, blocked facts, and substitution requirements. Both artifacts are available as markdown and JSON.

Screenshot facts are references only until a human or agent adds a confirmed fact with `evidence-add`. Manual facts that are added as approval-gated can be approved with `evidence-approve`. Linked tests that use substituted ids, field values, text, constants, or raw canvas replay without the required explanation are rejected or recorded as blocked in `session.json` and `.test-capture/ledger.json`.
