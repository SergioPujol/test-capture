#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const destination = path.join(codexHome, "skills", "test-capture");

const entries = [
  "bin",
  "src",
  "package.json",
  "package-lock.json",
  path.join(".agents", "skills", "test-capture", "SKILL.md"),
];

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

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

for (const entry of entries) {
  const source = path.join(root, entry);
  const target = entry.endsWith("SKILL.md")
    ? path.join(destination, "SKILL.md")
    : path.join(destination, entry);
  copyRecursive(source, target);
}

execFileSync("npm", ["install"], {
  cwd: destination,
  stdio: "inherit",
});

console.log(`Installed Test Capture Codex skill at ${destination}`);
console.log("Restart Codex or start a new thread, then invoke /test-capture from the app repo you want to test.");
