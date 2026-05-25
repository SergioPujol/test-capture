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

function packageDeps(pkg) {
  return {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
    ...(pkg?.optionalDependencies ?? {}),
  };
}

function listProjectFiles(root, limit = 1000) {
  const ignored = new Set([".git", "node_modules", ".test-capture", "dist", "build", "coverage"]);
  const files = [];
  function walk(dir) {
    if (files.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const rel = path.relative(root, absolute);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(rel);
      }
      if (files.length >= limit) return;
    }
  }
  try {
    walk(root);
  } catch {
    return [];
  }
  return files;
}

function detectTestStack(root, pkg, scripts, playwrightConfigs) {
  const deps = packageDeps(pkg);
  const scriptText = Object.entries(scripts).map(([name, command]) => `${name} ${command}`).join("\n");
  const projectFiles = listProjectFiles(root);
  const testFiles = projectFiles.filter((file) => /(^|\/)([^/]+\.)?(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)(__tests__|tests?|e2e|specs)\//.test(file));
  const configFiles = projectFiles.filter((file) => /(^|\/)(jest|vitest|playwright|cypress)\.config\.[cm]?[jt]s$/.test(file));
  const frameworkSignals = {
    jest: [
      Boolean(deps.jest || deps["ts-jest"] || deps["babel-jest"]),
      /(^|\s)jest(\s|$)/i.test(scriptText),
      configFiles.some((file) => /jest\.config\./.test(file)),
    ],
    vitest: [
      Boolean(deps.vitest),
      /(^|\s)vitest(\s|$)/i.test(scriptText),
      configFiles.some((file) => /vitest\.config\./.test(file)),
    ],
    "node-test": [
      /node\s+--test/i.test(scriptText),
      Boolean(pkg?.type === "module" && testFiles.some((file) => file.endsWith(".test.mjs"))),
    ],
    playwright: [
      Boolean(deps.playwright || deps["@playwright/test"]),
      /playwright\s+test/i.test(scriptText),
      playwrightConfigs.length > 0,
    ],
    cypress: [
      Boolean(deps.cypress),
      /(^|\s)cypress(\s|$)/i.test(scriptText),
      configFiles.some((file) => /cypress\.config\./.test(file)),
    ],
    rtl: [
      Boolean(deps["@testing-library/react"] || deps["@testing-library/dom"]),
      /@testing-library\//i.test(JSON.stringify(deps)),
    ],
  };
  const frameworks = Object.entries(frameworkSignals)
    .filter(([, signals]) => signals.some(Boolean))
    .map(([name]) => name);
  const browserE2EFrameworks = [
    ...(frameworkSignals.playwright[1] || frameworkSignals.playwright[2] ? ["playwright"] : []),
    ...(frameworkSignals.cypress[1] || frameworkSignals.cypress[2] ? ["cypress"] : []),
  ];
  const unitIntegrationFrameworks = frameworks.filter((name) => !["playwright", "cypress"].includes(name));
  const configuredRunners = Object.entries(scripts)
    .filter(([name, command]) => /test|spec|e2e|jest|vitest|playwright|cypress/i.test(`${name} ${command}`))
    .map(([name, command]) => ({ name, command }));
  const signalCount = Object.values(frameworkSignals).flat().filter(Boolean).length + testFiles.length + configuredRunners.length;
  const confidence = frameworks.length
    ? Math.min(1, Number((0.35 + signalCount * 0.12).toFixed(2)))
    : 0;
  return {
    provenance: provenance.toolGenerated,
    frameworks: frameworks.length ? frameworks : ["unknown"],
    browserE2EFrameworks,
    unitIntegrationFrameworks,
    configuredRunners,
    configFiles,
    testFiles: testFiles.slice(0, 30),
    confidence,
    policyWarnings: [
      ...(frameworks.length ? [] : ["repo test stack unknown; inspect existing conventions before creating tests"]),
      ...(browserE2EFrameworks.length ? [] : ["no browser e2e runner detected; do not add Playwright or Cypress without explicit approval"]),
    ],
  };
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
  const testStack = detectTestStack(root, pkg, scripts, playwrightConfigs);

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
    testStack,
    gitignoreWarnings: gitignoreContains(root, ".test-capture/") ? [] : [".test-capture/ is not ignored by git"],
  };
}
