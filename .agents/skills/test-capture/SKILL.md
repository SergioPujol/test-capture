---
name: test-capture
description: Run the agent-native Test Capture workflow from Codex. Use when the user invokes /test-capture, asks to capture a browser feature, or wants Codex to open a local app, let them manually verify it, then turn the captured session into a generated automated test.
metadata:
  short-description: Capture a manual browser verification and generate tests
---

# Test Capture Codex Workflow

Run this workflow when the user invokes `/test-capture` or asks Codex to capture a feature in a browser and generate tests from it.

## Inputs

Parse these from the user message:

- `--url <url>`: required target app URL.
- `--description <text>`: optional scenario description.
- `--screenshots`: optional, default on when the user did not specify privacy constraints.
- `--test-file <path>`: optional preferred generated test file.
- `--command <cmd>`: optional test command to run after generation.

If `--url` is missing, ask for it. Do not start capture without a URL.

## Workflow

1. Run `node ./bin/test-capture.js doctor`.
   - If Playwright is missing and this is the Test Capture repo, run `npm install`.
   - If the target app is unreachable, ask the user to start it or provide the correct URL.

2. Start manual capture from the repo root:

   ```sh
   node ./bin/test-capture.js start --url <url> --description "<description>" --screenshots
   ```

   Keep the command session open. It launches Chromium and waits for terminal input.

3. Tell the user:

   ```txt
   The capture browser is open. Click through the feature and verify the behavior. When finished, tell me "done" and I will stop capture and generate the test.
   ```

4. When the user says they are done, send a newline to the running capture process. Read the printed `sessionId`.

5. Inspect the capture:

   ```sh
   node ./bin/test-capture.js summary <session-id>
   node ./bin/test-capture.js selectors <session-id>
   node ./bin/test-capture.js network <session-id>
   node ./bin/test-capture.js testability <session-id>
   node ./bin/test-capture.js approve-scenario <session-id>
   node ./bin/test-capture.js coverage-plan <session-id>
   node ./bin/test-capture.js approve-coverage-plan <session-id>
   ```

6. Generate or update a maintainable test in the repository.
   - Use repo conventions and existing test folders.
   - Prefer role, label, text, and test-id selectors.
   - Do not translate raw clicks one-for-one.
   - Do not persist secrets or raw typed sensitive values.
   - Include assertions from the approved coverage plan.

7. Run the narrowest relevant test command.
   - If `--command` was supplied, use it.
   - Otherwise infer from repo scripts and the new test file.
   - For the bundled example app, use:

     ```sh
     CAPTURE_TARGET_BASE_URL=<url> npm test
     ```

8. If the test fails, triage with capture evidence:

   ```sh
   node ./bin/test-capture.js triage <session-id> --test-output <file-or-output>
   ```

   Fix generated-test failures and rerun. Ask the user only when the expected behavior is ambiguous.

9. Link the passing test:

   ```sh
   node ./bin/test-capture.js link-test <session-id> --file <test-file> --command "<command>" --status passing
   ```

10. Report:
    - session id
    - generated/updated test file
    - command run
    - pass/fail result
    - any remaining risks from `testability.md`

## Important Behavior

- This skill is the user-facing `/test-capture` entry point. Do not make the user manually orchestrate low-level commands after invoking it.
- The user manually drives the browser; Codex drives the workflow around the capture.
- Use `scripted-capture` only for automated dogfood/regression flows, not for the normal `/test-capture` user experience.
- Keep the work loop going until a test is generated, run, fixed, and linked, unless the user explicitly stops.
