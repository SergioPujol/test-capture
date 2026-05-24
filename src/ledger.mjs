import fs from "node:fs";
import path from "node:path";
import { captureError, errorNames } from "./errors.mjs";
import { ledgerPath, repoRoot } from "./paths.mjs";
import { nowIso } from "./time.mjs";

export function readLedger(cwd = process.cwd()) {
  const file = ledgerPath(cwd);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeLedger(entries, cwd = process.cwd()) {
  const file = ledgerPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

export function upsertLedgerEntry({ session, scenario, generatedTests = [], status, command }, cwd = process.cwd()) {
  const root = repoRoot(cwd);
  for (const testFile of generatedTests) {
    if (!fs.existsSync(path.join(root, testFile))) {
      throw captureError(errorNames.LedgerConsistencyError, `Linked test file does not exist: ${testFile}`, {
        sessionId: session.id,
        operation: "update_ledger",
        nextSafeAction: "Create the linked test file or remove it from the ledger update.",
      });
    }
  }
  const entries = readLedger(cwd);
  const entry = {
    sessionId: session.id,
    scenario: scenario || session.description || "Captured browser verification",
    generatedTests,
    status,
    command,
    lastVerified: nowIso(),
  };
  const index = entries.findIndex((existing) => existing.sessionId === session.id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  writeLedger(entries, cwd);
  return entry;
}
