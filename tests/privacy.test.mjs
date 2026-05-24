import test from "node:test";
import assert from "node:assert/strict";
import { redactEvent, redactHeaders, redactUrl, redactValue } from "../src/privacy.mjs";

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
