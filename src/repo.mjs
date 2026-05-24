import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";
import { provenance } from "./provenance.mjs";

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function branch(root) {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function gitignoreContains(root, pattern) {
  const file = path.join(root, ".gitignore");
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, "utf8").split(/\r?\n/).some((line) => line.trim() === pattern);
}

export function detectRepo(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const pkg = readJsonIfExists(path.join(root, "package.json"));
  const scripts = pkg?.scripts ?? {};
  const packageManager = exists(root, "pnpm-lock.yaml")
    ? "pnpm"
    : exists(root, "yarn.lock")
      ? "yarn"
      : exists(root, "package-lock.json")
        ? "npm"
        : pkg?.packageManager?.split("@")[0] ?? "unknown";
  const playwrightConfigs = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
    "playwright.config.cjs",
  ].filter((rel) => exists(root, rel));
  const testFolders = ["tests", "test", "e2e", "specs", "__tests__"].filter((rel) => exists(root, rel));
  const likelyTestCommands = Object.entries(scripts)
    .filter(([name]) => /test|e2e|playwright/i.test(name))
    .map(([name, command]) => ({ name, command }));

  return {
    provenance: provenance.toolGenerated,
    root,
    branch: branch(root),
    packageManager,
    hasPackageJson: Boolean(pkg),
    playwrightInstalled: Boolean(pkg?.dependencies?.playwright ?? pkg?.devDependencies?.playwright),
    playwrightConfigs,
    testFolders,
    likelyTestCommands,
    gitignoreWarnings: gitignoreContains(root, ".test-capture/") ? [] : [".test-capture/ is not ignored by git"],
  };
}
