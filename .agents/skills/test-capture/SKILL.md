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

1. Resolve the Test Capture runner before running any command.
   - If `./bin/test-capture.js` exists in the current repository, use `node ./bin/test-capture.js`.
   - Otherwise, use the installed Test Capture skill runner path from the local Codex skills directory.
   - Keep the working directory set to the target application repository. The runner uses `process.cwd()` to write `.test-capture/` artifacts and inspect package/test conventions.

2. Run `<runner> doctor`.
   - If Playwright is missing and this is the Test Capture repo, run `npm install`.
   - If `./bin/test-capture.js` is missing in the target app repo but the installed skill runner exists, continue with that runner instead of treating it as a blocker.
   - If the target app is unreachable, ask the user to start it or provide the correct URL.

3. Start manual capture from the target app repo root:

   ```sh
   <runner> start --url <url> --description "<description>" --screenshots
   ```

   Keep the command session open. It launches Chromium and waits for terminal input.

4. Tell the user:

   ```txt
   The capture browser is open. Click through the feature and verify the behavior. When finished, tell me "done" and I will stop capture and generate the test.
   ```

5. When the user says they are done, send a newline to the running capture process. Read the printed `sessionId`.

6. Inspect the capture:

   ```sh
   <runner> summary <session-id>
   <runner> selectors <session-id>
   <runner> network <session-id>
   <runner> testability <session-id>
   <runner> approve-scenario <session-id>
   <runner> coverage-plan <session-id>
   <runner> approve-coverage-plan <session-id>
   ```

7. Generate or update a maintainable test in the repository.
   - Use repo conventions and existing test folders.
   - Prefer role, label, text, and test-id selectors.
   - Do not translate raw clicks one-for-one.
   - Do not persist secrets or raw typed sensitive values.
   - Include assertions from the approved coverage plan.

8. Run the narrowest relevant test command.
   - If `--command` was supplied, use it.
   - Otherwise infer from repo scripts and the new test file.
   - For the bundled example app, use:

     ```sh
     CAPTURE_TARGET_BASE_URL=<url> npm test
     ```

9. If the test fails, triage with capture evidence:

   ```sh
   <runner> triage <session-id> --test-output <file-or-output>
   ```

   Fix generated-test failures and rerun. Ask the user only when the expected behavior is ambiguous.

10. Link the passing test:

   ```sh
   <runner> link-test <session-id> --file <test-file> --command "<command>" --status passing
   ```

11. Report:
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
