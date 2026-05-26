#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const agentConfigs = {
  codex: {
    name: "Codex",
    homeEnv: "CODEX_HOME",
    defaultHome: () => path.join(os.homedir(), ".codex"),
    skillSource: path.join(".agents", "skills", "test-capture", "SKILL.md"),
    restartText: "Restart Codex or start a new thread, then invoke /test-capture from the app repo you want to test.",
  },
  claude: {
    name: "Claude Code",
    homeEnv: "CLAUDE_HOME",
    defaultHome: () => path.join(os.homedir(), ".claude"),
    skillSource: path.join(".claude", "skills", "test-capture", "SKILL.md"),
    restartText: "Restart Claude Code or start a new session, then invoke /test-capture from the app repo you want to test.",
  },
};

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundleEntries = [
  "bin",
  "src",
  "package.json",
  "package-lock.json",
];

export function resolveAgentConfig(agent) {
  const config = agentConfigs[agent];
  if (!config) {
    throw new Error(`Unsupported agent "${agent}". Expected one of: ${Object.keys(agentConfigs).join(", ")}`);
  }
  return config;
}

export function resolveAgentHome(config, env = process.env) {
  return env[config.homeEnv] || config.defaultHome();
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function installAgentSkill(agent, options = {}) {
  const config = resolveAgentConfig(agent);
  const root = options.root || packageRoot;
  const home = options.home || resolveAgentHome(config, options.env);
  const destination = path.join(home, "skills", "test-capture");
  const installDependencies = options.installDependencies ?? true;
  const execFile = options.execFile || execFileSync;
  const log = options.log || console.log;

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of bundleEntries) {
    copyRecursive(path.join(root, entry), path.join(destination, entry));
  }
  copyRecursive(path.join(root, config.skillSource), path.join(destination, "SKILL.md"));

  if (installDependencies) {
    execFile("npm", ["install"], {
      cwd: destination,
      stdio: "inherit",
    });
  }

  log(`Installed Test Capture ${config.name} skill at ${destination}`);
  log(config.restartText);
  return { destination, agent, home };
}

function usage() {
  return `Usage: node scripts/install-agent-skill.mjs <codex|claude>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const agent = process.argv[2];
  if (!agent) {
    console.error(usage());
    process.exit(1);
  }
  try {
    installAgentSkill(agent);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
