import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

export function packageRoot() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

export function sessionRoot(cwd = process.cwd()) {
  return path.join(repoRoot(cwd), ".test-capture", "sessions");
}

export function ledgerPath(cwd = process.cwd()) {
  return path.join(repoRoot(cwd), ".test-capture", "ledger.json");
}
