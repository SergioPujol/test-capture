---
name: test-capture
description: Run the agent-native Test Capture workflow from Claude Code. Use when the user invokes /test-capture, asks to capture a browser feature, or wants Claude to open a local app, let them manually verify it, then turn the captured session into a generated automated test.
metadata:
  short-description: Capture a manual browser verification and generate tests
---

# Test Capture Claude Workflow

Run this workflow when the user invokes `/test-capture` or asks Claude to capture a feature in a browser and generate tests from it.

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
   - First identify the current repository root, even when Claude starts inside a subdirectory such as an example app.
   - If `<repo-root>/bin/test-capture.js` exists in the current repository, use that local runner from the repo root, for example `node ./bin/test-capture.js` or `node ../../bin/test-capture.js` depending on the command working directory.
   - Otherwise, use the installed Test Capture skill runner path from the local Claude skills directory: `~/.claude/skills/test-capture/bin/test-capture.js`.
   - If `CLAUDE_HOME` is set, use `$CLAUDE_HOME/skills/test-capture/bin/test-capture.js` instead of `~/.claude/skills/test-capture/bin/test-capture.js`.
   - Keep the working directory set to the repository that should receive `.test-capture/` artifacts and generated tests. If the app being captured lives in a subdirectory of that repo, start its dev server from the app directory but run Test Capture commands from the repo root.

2. Run `<runner> doctor --url <url>`.
   - If Playwright is missing and this is the Test Capture repo, run `npm install`.
   - If `./bin/test-capture.js` is missing in the target app repo but the installed skill runner exists, continue with that runner instead of treating it as a blocker.
   - If the target app is unreachable, ask the user to start it or provide the correct URL.

3. Start manual capture from the repository root that should store the capture artifacts:

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
   <runner> evidence-pack <session-id>
   <runner> evidence-pack <session-id> --json
   <runner> test-outline <session-id>
   <runner> test-outline <session-id> --json
   <runner> coverage-plan <session-id>
   ```

   Read the scenario, testability findings, evidence pack, structured test outline, and coverage plan before approving them. Treat `evidence-pack.md` / `evidence-pack.json` as the source of truth for domain ids, typed values, selectors, and assertions. Treat `test-outline.md` / `test-outline.json` as the contract for required assertions, allowed mechanics, recommended locators, blocked facts, and substitution requirements. Screenshot-derived or masked values must be confirmed with:

   ```sh
   <runner> evidence-add <session-id> --fact "<confirmed fact>" --source <event-id-or-artifact-path> --classification observed
   ```

   If a manual fact was added with `--requires-approval`, approve it only after inspection:

   ```sh
   <runner> evidence-approve <session-id> --fact-id <manual-fact-id>
   ```

   Do not approve generated screenshot reference facts in place. They only prove that a screenshot file exists; values read from screenshots must be added as explicit observed facts.

   Only run `approve-scenario` and `approve-coverage-plan` after confirming they match the captured intent and evidence. If either artifact has a "Blocking Questions" section, approval-gated evidence, or calls out a strategy choice that changes the test shape, ask the user for that decision instead of self-approving it.

7. Generate or update a maintainable test in the repository.
   - Use repo conventions and existing test folders.
   - Prefer role, label, text, and test-id selectors.
   - Do not translate raw clicks one-for-one.
   - Do not persist secrets or raw typed sensitive values.
   - Do not invent domain ids, field values, visible text, role names, constants, or fixture values from repo knowledge when evidence has observed values. If substitution is necessary, record the reason and expect `link-test` to validate it.
   - Do not replay raw canvas/SVG clicks when the test outline says browser e2e needs instrumentation or lower-level coverage.
   - Include assertions from the structured test outline and approved coverage plan.

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

   If the test intentionally substitutes fixture values or mechanics, pass a concrete substitution/deviation reason. Do not use a deviation reason to bypass raw canvas replay that the outline marks unsupported.

11. Report:
    - session id
    - generated/updated test file
    - command run
    - pass/fail result
    - any remaining risks from `testability.md`

## Important Behavior

- This skill is the user-facing `/test-capture` entry point. Do not make the user manually orchestrate low-level commands after invoking it.
- The user manually drives the browser; Claude drives the workflow around the capture.
- Use `scripted-capture` only for automated dogfood/regression flows, not for the normal `/test-capture` user experience.
- Keep the work loop going until a test is generated, run, fixed, and linked, unless the user explicitly stops.
