# Capture Target

Capture Target is a modern React fixture app for testing Test Capture end to end. It behaves like a small customer administration product, with routing, forms, async API calls, toast notifications, tables, modal dialogs, console events, sensitive fields, and a few intentional testability problems.

The app is not meant to be a production customer dashboard. Its purpose is to provide a realistic browser surface that helps validate whether Test Capture correctly records manual verification sessions and produces useful artifacts for an AI coding agent.

## What This Project Tests

Capture Target exercises the main Test Capture evidence types:

- user clicks and typed input
- route navigation
- stable selector candidates through `data-testid`
- brittle selector cases
- successful, slow, and failing network requests
- console warnings and errors
- screenshots when capture is started with `--screenshots`
- sensitive data masking and token URL redaction
- scenario summaries, coverage plans, testability findings, and failure triage

## Pages

### Dashboard

The dashboard is the entry point for the fixture. It introduces the available test surfaces and links into the main customer flow.

Features:

- summary metrics for the fixture surface
- navigation into customer, billing, activity, and error scenarios
- a primary **Start customer flow** action with a stable selector

### Customer

The customer page models a common admin workflow: editing account information and saving it through an API.

Features:

- async customer loading from `/api/customer`
- editable billing email
- editable customer plan
- editable account notes
- save action through `PATCH /api/customer`
- success and error toast states
- stable selectors for form fields and save action

### Billing

The billing page focuses on privacy and redaction behavior.

Features:

- admin email input
- password input
- access token input
- private memo field
- submit action that calls `POST /api/login`
- private endpoint call to `/api/private?token=...`
- intentional unlabeled reimbursement-code input for testability findings

Expected Test Capture behavior:

- typed values are masked unless explicitly enabled
- password values are redacted
- token-like URL query parameters are redacted in persisted artifacts

### Activity

The activity page models a searchable operational table with row-level actions.

Features:

- activity fetch through `/api/activity`
- search input that updates network evidence
- **Billing only** filter shortcut
- severity badges
- row-specific open actions
- modal detail view with confirm and cancel actions
- intentionally brittle decorative row action for selector-quality testing

### Error Lab

The error lab provides deterministic failure and diagnostic controls.

Features:

- console warning trigger
- console error trigger
- slow request trigger through `/api/slow`
- failed request trigger through `/api/fail`
- intentionally nameless button for accessibility and selector findings

## Architecture

The fixture follows a typical small modern React app structure:

```txt
src/
  components/
    layout/      app shell and page header
    ui/          shared button, badge, field, modal, and toast primitives
  features/      feature-specific UI for customer, activity, and error lab flows
  routes/        route-level page composition
  services/      API clients and request handling
  types/         shared domain contracts
  utils/         formatting helpers
```

The mock API is implemented as Vite middleware in `vite.config.ts`. This keeps the fixture self-contained while still producing real browser network events.

## Run

From the repository root:

```sh
npm run capture-target:install
npm run capture-target:dev
```

Then start a capture:

```sh
node ./bin/test-capture.js start --url http://127.0.0.1:5173 --screenshots
```

## Recommended Capture Scenarios

### Customer Save Flow

1. Open the dashboard.
2. Click **Start customer flow**.
3. Change the billing email.
4. Change the plan.
5. Save the profile.
6. Confirm the success toast appears.

Useful commands after capture:

```sh
node ./bin/test-capture.js summary <session-id>
node ./bin/test-capture.js selectors <session-id>
node ./bin/test-capture.js network <session-id>
node ./bin/test-capture.js approve-scenario <session-id>
node ./bin/test-capture.js coverage-plan <session-id>
```

### Privacy Flow

1. Open **Billing**.
2. Type an admin email.
3. Type a password.
4. Type an access token.
5. Type a private memo.
6. Click **Submit sensitive flow**.

Expected capture behavior:

- typed values are masked unless explicitly enabled
- password values are redacted
- `/api/private?token=...` is redacted in persisted URLs

### Activity Flow

1. Open **Activity**.
2. Search for `billing`.
3. Click **Billing only**.
4. Open an activity row.
5. Confirm the modal.

Expected capture behavior:

- table filtering creates network evidence
- modal actions are captured
- row-level `data-testid` selectors appear in selector candidates

### Error Lab Flow

1. Open **Error Lab**.
2. Trigger a console warning.
3. Trigger a console error.
4. Trigger a slow request.
5. Trigger a failed request.

Useful command:

```sh
node ./bin/test-capture.js testability <session-id>
```

## Intentional Testability Issues

The fixture includes:

- an unlabeled reimbursement code input
- a nameless button in the error lab
- a brittle decorative row action in the activity table

These are present so `testability.md` has meaningful findings.

## Triage Fixture

To test triage, create a text file containing a selector failure such as:

```txt
Error: locator('[data-testid="missing-customer-save"]').not found
```

Then run:

```sh
node ./bin/test-capture.js triage <session-id> --test-output ./missing-selector.txt
```
