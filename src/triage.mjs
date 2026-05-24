import fs from "node:fs";
import { captureError, errorNames } from "./errors.mjs";
import { provenance } from "./provenance.mjs";

export function parseTestOutput(inputOrFile) {
  if (!inputOrFile) {
    throw captureError(errorNames.TestOutputParseError, "Test output is required for failure triage.", {
      operation: "triage_test_failure",
      nextSafeAction: "Pass --test-output <file> or provide captured test output.",
    });
  }
  if (fs.existsSync(inputOrFile)) return fs.readFileSync(inputOrFile, "utf8");
  return inputOrFile;
}

export function triageFailure({ session, index, testOutput }) {
  const output = parseTestOutput(testOutput);
  const lower = output.toLowerCase();
  const evidence = [];
  let classification = "generated test is wrong";
  if (/timeout|timed out|waiting for/i.test(output)) classification = "timing or animation flake";
  if (/locator|strict mode|selector|not found/i.test(output)) classification = "selector is brittle";
  if (/econnrefused|server|localhost|connection refused/i.test(output)) classification = "local app/server is unavailable";
  if (/401|403|unauthorized|forbidden|auth/i.test(output)) classification = "auth or setup data is missing";
  if (index.network.some((event) => event.status >= 500)) evidence.push("capture includes server error responses");
  if (index.console.some((event) => event.type === "error")) evidence.push("capture includes console errors");
  const failingLine = output.split(/\r?\n/).find((line) => /error|failed|expect|timeout|locator/i.test(line)) ?? "No focused failing line detected.";

  return {
    provenance: provenance.agentAuthored,
    sessionId: session.id,
    classification,
    failingLine,
    evidence,
    nextSafeAction:
      lower.includes("timeout") || lower.includes("locator")
        ? "Compare the generated selector and wait condition against selector candidates and captured screenshots."
        : "Compare the failing assertion against the approved coverage plan and captured behavior.",
  };
}
