import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installAgentSkill, resolveAgentConfig, resolveAgentHome } from "../scripts/install-agent-skill.mjs";

function writeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-install-"));
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".agents", "skills", "test-capture"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "skills", "test-capture"), { recursive: true });
  fs.writeFileSync(path.join(root, "bin", "test-capture.js"), "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(root, "src", "cli.mjs"), "export const ok = true;\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test-capture" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "test-capture", lockfileVersion: 3 }));
  fs.writeFileSync(path.join(root, ".agents", "skills", "test-capture", "SKILL.md"), "Codex skill\n");
  fs.writeFileSync(path.join(root, ".claude", "skills", "test-capture", "SKILL.md"), "Claude skill\n");
  return root;
}

test("installer bundles the Codex skill into CODEX_HOME", () => {
  const root = writeFixtureRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-codex-home-"));
  const logs = [];

  const result = installAgentSkill("codex", {
    root,
    home,
    installDependencies: false,
    log: (line) => logs.push(line),
  });

  assert.equal(result.destination, path.join(home, "skills", "test-capture"));
  assert.equal(fs.readFileSync(path.join(result.destination, "SKILL.md"), "utf8"), "Codex skill\n");
  assert.ok(fs.existsSync(path.join(result.destination, "bin", "test-capture.js")));
  assert.ok(logs.some((line) => line.includes("Codex skill")));
});

test("installer bundles the Claude Code skill into CLAUDE_HOME", () => {
  const root = writeFixtureRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "test-capture-claude-home-"));
  const logs = [];

  const result = installAgentSkill("claude", {
    root,
    home,
    installDependencies: false,
    log: (line) => logs.push(line),
  });

  assert.equal(result.destination, path.join(home, "skills", "test-capture"));
  assert.equal(fs.readFileSync(path.join(result.destination, "SKILL.md"), "utf8"), "Claude skill\n");
  assert.ok(fs.existsSync(path.join(result.destination, "src", "cli.mjs")));
  assert.ok(logs.some((line) => line.includes("Claude Code skill")));
});

test("agent home resolution honors per-agent environment variables", () => {
  assert.equal(resolveAgentHome(resolveAgentConfig("codex"), { CODEX_HOME: "/tmp/codex-home" }), "/tmp/codex-home");
  assert.equal(resolveAgentHome(resolveAgentConfig("claude"), { CLAUDE_HOME: "/tmp/claude-home" }), "/tmp/claude-home");
  assert.throws(() => resolveAgentConfig("unknown"), /Unsupported agent/);
});
