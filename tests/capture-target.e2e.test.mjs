import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.CAPTURE_TARGET_BASE_URL;

async function withPage(run) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

test("capture target customer profile can be edited and saved", { skip: !baseUrl }, async () => {
  await withPage(async (page) => {
    await page.goto(baseUrl);
    await page.getByTestId("start-customer-flow").click();
    await page.getByTestId("billing-email-input").fill("finance+generated@example.com");
    await page.getByTestId("plan-select").selectOption("enterprise");
    await page.getByTestId("account-notes-input").fill("Generated from Test Capture evidence");

    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/customer") && response.request().method() === "PATCH",
    );
    await page.getByTestId("save-customer-button").click();
    const response = await responsePromise;

    assert.equal(response.status(), 200);
    await page.getByText("Billing email saved as finance+generated@example.com").waitFor();
  });
});

test("capture target customer can save billing admin email", { skip: !baseUrl }, async () => {
  await withPage(async (page) => {
    const unexpectedConsoleEvents = [];
    page.on("console", (message) => {
      const text = message.text();
      const isKnownReactRouterWarning = text.includes("React Router Future Flag Warning");
      if (["error", "warning"].includes(message.type()) && !isKnownReactRouterWarning) {
        unexpectedConsoleEvents.push({ type: message.type(), text });
      }
    });

    await page.goto(baseUrl);
    await page.getByRole("link", { name: "Billing", exact: true }).click();

    await page.getByLabel("Admin email").fill("billing-admin.generated@example.com");
    await page.getByLabel("Password").fill("example-password");
    await page.getByLabel("Access token").fill("example-token-123");
    await page.getByLabel("Private billing memo").fill("Generated billing memo");

    await assert.rejects(
      page.getByText("billing-admin.generated@example.com").waitFor({ timeout: 250 }),
    );

    const loginResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/login") && response.request().method() === "POST",
    );
    const privateResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/private?token="),
    );

    await page.getByTestId("submit-sensitive-flow").click();
    const [loginResponse, privateResponse] = await Promise.all([
      loginResponsePromise,
      privateResponsePromise,
    ]);

    assert.equal(loginResponse.status(), 200);
    assert.equal(privateResponse.status(), 200);
    await page.getByText("Sensitive flow completed").waitFor();
    assert.deepEqual(unexpectedConsoleEvents, []);
  });
});

test("capture target primary tabs expose interactive content", { skip: !baseUrl }, async () => {
  await withPage(async (page) => {
    const expectedConsoleEvents = [];
    const unexpectedConsoleEvents = [];
    page.on("console", (message) => {
      const text = message.text();
      const isKnownReactRouterWarning = text.includes("React Router Future Flag Warning");
      const isExpectedDiagnosticEvent =
        text.includes("Synthetic warning from Capture Target") ||
        text.includes("Synthetic error from Capture Target") ||
        text.includes("Failed to load resource: the server responded with a status of 502");

      if (isExpectedDiagnosticEvent) {
        expectedConsoleEvents.push({ type: message.type(), text });
      } else if (["error", "warning"].includes(message.type()) && !isKnownReactRouterWarning) {
        unexpectedConsoleEvents.push({ type: message.type(), text });
      }
    });

    await page.goto(baseUrl);
    await page.getByRole("heading", { name: "Modern app surface for capture testing" }).waitFor();

    const customerLoadPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/customer") && response.request().method() === "GET",
    );
    await page.getByTestId("start-customer-flow").click();
    assert.equal((await customerLoadPromise).status(), 200);

    await page.getByTestId("billing-email-input").fill("finance+all-tabs@example.com");
    await page.getByTestId("plan-select").selectOption("growth");
    await page.getByTestId("account-notes-input").fill("All primary tabs were verified from capture evidence.");

    const customerSavePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/customer") && response.request().method() === "PATCH",
    );
    await page.getByTestId("save-customer-button").click();
    assert.equal((await customerSavePromise).status(), 200);
    await page.getByText("Billing email saved as finance+all-tabs@example.com").waitFor();

    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.getByRole("heading", { name: "Modern app surface for capture testing" }).waitFor();

    await page.getByRole("link", { name: "Billing", exact: true }).click();
    await page.getByRole("heading", { name: "Privacy and form capture" }).waitFor();
    await page.getByTestId("billing-admin-email").fill("billing-admin.all-tabs@example.com");
    await page.getByTestId("billing-password").fill("example-password");
    await page.getByTestId("billing-access-token").fill("example-token-123");
    await page.getByTestId("billing-private-memo").fill("All tabs billing memo");
    await page.getByTestId("unlabeled-reimbursement-code").fill("REIM-42");

    const loginResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/login") && response.request().method() === "POST",
    );
    const privateResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/private?token="),
    );
    await page.getByTestId("submit-sensitive-flow").click();
    const [loginResponse, privateResponse] = await Promise.all([
      loginResponsePromise,
      privateResponsePromise,
    ]);
    assert.equal(loginResponse.status(), 200);
    assert.equal(privateResponse.status(), 200);
    await page.getByText("Sensitive flow completed").waitFor();

    const initialActivityPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/activity") && response.request().method() === "GET",
    );
    await page.getByRole("link", { name: "Activity", exact: true }).click();
    assert.equal((await initialActivityPromise).status(), 200);

    const searchActivityPromise = page.waitForResponse((response) =>
      response.url().includes("/api/activity?query=mara"),
    );
    await page.getByTestId("activity-search-input").fill("mara");
    assert.equal((await searchActivityPromise).status(), 200);

    const filteredActivityPromise = page.waitForResponse((response) =>
      response.url().includes("/api/activity?query=billing"),
    );
    await page.getByTestId("activity-filter-button").click();
    assert.equal((await filteredActivityPromise).status(), 200);
    await page.getByTestId("open-activity-act_001").click();
    await page.getByRole("dialog").waitFor();
    await page.getByTestId("confirm-modal-action").click();
    await assert.rejects(page.getByRole("dialog").waitFor({ timeout: 250 }));

    await page.getByRole("link", { name: "Error Lab", exact: true }).click();
    await page.getByRole("heading", { name: "Network and console lab" }).waitFor();
    await page.getByTestId("trigger-console-warning").click();
    await page.getByTestId("trigger-console-error").click();

    const slowResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/slow"));
    await page.getByTestId("trigger-slow-request").click();
    assert.equal((await slowResponsePromise).status(), 200);
    await page.getByText(/Slow request completed/).waitFor();

    const failResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/fail"));
    await page.getByTestId("trigger-failed-request").click();
    assert.equal((await failResponsePromise).status(), 502);
    await page.getByText("Synthetic billing gateway failure").waitFor();

    assert.ok(expectedConsoleEvents.some((event) => event.type === "warning"));
    assert.ok(expectedConsoleEvents.some((event) => event.type === "error"));
    assert.deepEqual(unexpectedConsoleEvents, []);
  });
});

test("capture target privacy, activity, and diagnostics flows expose expected evidence", { skip: !baseUrl }, async () => {
  await withPage(async (page) => {
    const consoleEvents = [];
    page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text() }));

    await page.goto(baseUrl);
    await page.getByRole("link", { name: "Billing", exact: true }).click();
    await page.getByTestId("billing-admin-email").fill("admin.generated@example.com");
    await page.getByTestId("billing-password").fill("not-a-real-password");
    await page.getByTestId("billing-access-token").fill("generated-token-123");
    await page.getByTestId("billing-private-memo").fill("Generated private memo");
    await page.getByTestId("unlabeled-reimbursement-code").fill("REIM-99");

    const privateResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/private?token="),
    );
    await page.getByTestId("submit-sensitive-flow").click();
    const privateResponse = await privateResponsePromise;
    assert.equal(privateResponse.status(), 200);
    await page.getByText("Sensitive flow completed").waitFor();

    await page.getByRole("link", { name: "Activity", exact: true }).click();
    await page.getByTestId("activity-search-input").fill("billing");
    const activityResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/activity?query=billing"),
    );
    await page.getByTestId("activity-filter-button").click();
    const activityResponse = await activityResponsePromise;
    assert.equal(activityResponse.status(), 200);
    await page.getByTestId("open-activity-act_001").click();
    await page.getByTestId("confirm-modal-action").click();

    await page.getByRole("link", { name: "Error Lab", exact: true }).click();
    await page.getByTestId("trigger-console-warning").click();
    await page.getByTestId("trigger-console-error").click();

    const slowResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/slow"));
    await page.getByTestId("trigger-slow-request").click();
    assert.equal((await slowResponsePromise).status(), 200);
    await page.getByText(/Slow request completed/).waitFor();

    const failResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/fail"));
    await page.getByTestId("trigger-failed-request").click();
    assert.equal((await failResponsePromise).status(), 502);
    await page.getByText("Synthetic billing gateway failure").waitFor();

    assert.ok(consoleEvents.some((event) => event.type === "warning"));
    assert.ok(consoleEvents.some((event) => event.type === "error"));
  });
});
