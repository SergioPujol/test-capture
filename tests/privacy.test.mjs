import test from "node:test";
import assert from "node:assert/strict";
import {
  redactEvent,
  redactHeaders,
  redactUrl,
  redactValue,
  redactionSummary,
  sanitizeCaptureForPersistence,
} from "../src/privacy.mjs";

test("redacts secret query parameters", () => {
  assert.equal(
    redactUrl("http://localhost:3000/callback?token=abc123&next=/dashboard"),
    "http://localhost:3000/callback?token=%5BREDACTED%5D&next=%2Fdashboard",
  );
});

test("redacts secret headers", () => {
  assert.deepEqual(redactHeaders({ Authorization: "Bearer abc", Accept: "application/json" }), {
    Authorization: "[REDACTED]",
    Accept: "application/json",
  });
});

test("masks typed values by default", () => {
  assert.equal(redactValue("email", "person@example.com"), "[MASKED]");
  assert.equal(redactValue("password", "super-secret", { allowSensitiveValues: true }), "[REDACTED]");
});

test("redacts event payloads", () => {
  const event = redactEvent({
    type: "input",
    url: "http://app.test?api_key=secret",
    label: "Email",
    value: "person@example.com",
    headers: { cookie: "sid=1" },
  });
  assert.equal(event.value, "[MASKED]");
  assert.equal(event.headers.cookie, "[REDACTED]");
  assert.match(event.url, /api_key=%5BREDACTED%5D/);
});

test("normalizes privacy summary from session privacy keys", () => {
  assert.deepEqual(redactionSummary({
    allowScreenshots: true,
    allowNetworkBodies: true,
    allowTypedText: true,
    allowTrace: true,
    preserveProfile: true,
  }), {
    mode: "strict",
    secretsPersisted: false,
    screenshotsMayContainSensitiveData: true,
    networkBodiesPersisted: true,
    typedTextPersisted: true,
    tracePersisted: true,
    browserProfilePersisted: true,
    rules: [
      "cookies, authorization headers, tokens, passwords, and API keys are redacted",
      "typed values are masked unless explicitly enabled for a session",
      "query parameters with secret-like names are redacted",
      "request and response bodies are not persisted by default",
    ],
  });
});

test("sanitizes captured artifacts before persistence", () => {
  const sanitized = sanitizeCaptureForPersistence({
    privacy: {
      allowScreenshots: true,
      allowTypedText: false,
      allowNetworkBodies: false,
    },
  }, {
    events: [
      { type: "input", label: "Admin email", value: "admin@northstar.test" },
      { type: "input", label: "Private billing memo", value: "private test" },
      { type: "input", label: "Access token", value: "1234" },
    ],
    network: [{
      method: "POST",
      url: "http://127.0.0.1:5174/api/private?token=1234",
      status: 200,
      postData: "token=1234&memo=private test",
    }],
    console: [{ type: "warning", message: "Bearer secret-token" }],
    screenshots: [{ id: "shot-1", path: "screenshots/0001.png" }],
    humanMarkers: [{ id: "marker-1", type: "assert", note: "uses token=1234" }],
    uncertainties: ["callback used token=1234"],
  });

  const persisted = JSON.stringify(sanitized);
  assert.doesNotMatch(persisted, /admin@northstar|private test|token=1234|secret-token/);
  assert.equal(sanitized.events[0].value, "[MASKED]");
  assert.equal(sanitized.events[1].value, "[REDACTED]");
  assert.equal(sanitized.events[2].value, "[REDACTED]");
  assert.match(sanitized.network[0].url, /token=%5BREDACTED%5D/);
  assert.equal(sanitized.network[0].postData, "[NOT_PERSISTED]");
  assert.equal(sanitized.screenshots[0].sensitive, true);
});
