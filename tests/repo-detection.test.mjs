import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectRepo } from "../src/repo.mjs";

function tempProject(name, pkg, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `test-capture-${name}-`));
  fs.writeFileSync(path.join(root, ".gitignore"), ".test-capture/\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test("detects Jest-only repos without browser e2e runners", () => {
  const cwd = tempProject("jest", {
    scripts: { test: "jest" },
    devDependencies: { jest: "^29.0.0" },
  }, {
    "tests/customer.test.ts": "test('works', () => {});\n",
  });

  const repo = detectRepo(cwd);
  assert.deepEqual(repo.testStack.frameworks, ["jest"]);
  assert.deepEqual(repo.testStack.browserE2EFrameworks, []);
  assert.deepEqual(repo.testStack.unitIntegrationFrameworks, ["jest"]);
  assert.match(repo.testStack.policyWarnings.join("\n"), /no browser e2e runner detected/);
  assert.equal(repo.testStack.configuredRunners[0].name, "test");
});

test("detects Playwright repos as browser e2e capable", () => {
  const cwd = tempProject("playwright", {
    scripts: { e2e: "playwright test" },
    devDependencies: { "@playwright/test": "^1.44.0" },
  }, {
    "playwright.config.ts": "export default {};\n",
    "e2e/customer.spec.ts": "test('works', async () => {});\n",
  });

  const repo = detectRepo(cwd);
  assert.ok(repo.testStack.frameworks.includes("playwright"));
  assert.deepEqual(repo.testStack.browserE2EFrameworks, ["playwright"]);
  assert.equal(repo.testStack.policyWarnings.length, 0);
});

test("marks repos with no recognizable test stack as unknown", () => {
  const cwd = tempProject("unknown", {
    scripts: { build: "tsc" },
    devDependencies: {},
  });

  const repo = detectRepo(cwd);
  assert.deepEqual(repo.testStack.frameworks, ["unknown"]);
  assert.equal(repo.testStack.confidence, 0);
  assert.match(repo.testStack.policyWarnings.join("\n"), /repo test stack unknown/);
});
