import fs from "node:fs";
import path from "node:path";
import { createSession, listSessions, readIndex, readSession, sessionDir } from "./session-store.mjs";
import { add_intent_marker } from "./agent-tools.mjs";
import { detectRepo } from "./repo.mjs";
import { recordInteractiveCapture } from "./recorder.mjs";
import {
  approveCoveragePlan,
  approveScenario,
  finalizeCapture,
  generateCoveragePlan,
  generateScenario,
  linkGeneratedTest,
  triageSessionFailure,
} from "./operations.mjs";
import { readLedger } from "./ledger.mjs";
import { sessionRoot } from "./paths.mjs";
import { captureError, errorNames } from "./errors.mjs";

function parseArgs(args) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { flags, positionals };
}

function print(data, json = false) {
  if (json || typeof data !== "string") console.log(JSON.stringify(data, null, 2));
  else console.log(data);
}

function usage() {
  return `Usage: test-capture <command>

Commands:
  start --url <url> [--description <text>] [--screenshots]
  stop [session-id]
  list-sessions
  summary <session-id>
  step <session-id> <n>
  network <session-id>
  screenshots <session-id>
  selectors <session-id>
  mark <session-id> --type assert|ignore|setup|bug|persist-after-reload|split-test [--note <text>] [--step <event-id>]
  coverage-plan <session-id>
  approve-scenario <session-id>
  approve-coverage-plan <session-id>
  testability <session-id>
  triage <session-id> --test-output <file>
  link-test <session-id> --file <path> --command <cmd> [--status passing|failing]
  ledger
  doctor
  clean --yes`;
}

function requireArg(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function readTextArtifact(sessionId, artifact, cwd = process.cwd()) {
  const file = path.join(sessionDir(sessionId, cwd), artifact);
  if (!fs.existsSync(file)) {
    throw captureError(errorNames.SessionArtifactNotFoundError, `Missing artifact ${artifact}.`, {
      sessionId,
      operation: `read_${artifact}`,
      nextSafeAction: "Generate the artifact with the matching command first.",
    });
  }
  return fs.readFileSync(file, "utf8");
}

async function hasPlaywright() {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

export async function runCli(args) {
  const [command, ...rest] = args;
  const { flags, positionals } = parseArgs(rest);
  const json = Boolean(flags.json);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
      print(usage());
      return;
    case "doctor": {
      const repo = detectRepo();
      print({
        ok: repo.gitignoreWarnings.length === 0,
        repo,
        playwrightImportable: await hasPlaywright(),
        nextActions: [
          ...(repo.gitignoreWarnings.length ? ["Add .test-capture/ to .gitignore"] : []),
          ...((await hasPlaywright()) ? [] : ["Install Playwright in the host project to enable browser capture"]),
        ],
      }, true);
      return;
    }
    case "start": {
      const url = requireArg(flags.url, "start requires --url <url>");
      const session = createSession({
        url,
        description: flags.description,
        privacy: {
          allowScreenshots: Boolean(flags.screenshots),
          allowTypedText: Boolean(flags["typed-text"]),
          allowNetworkBodies: Boolean(flags["network-bodies"]),
        },
      });
      if (flags["no-browser"]) {
        print({ sessionId: session.id, state: session.state, note: "Created session without launching browser." }, true);
        return;
      }
      const result = await recordInteractiveCapture(session);
      generateScenario(result.session.id);
      print({ sessionId: result.session.id, state: "SCENARIO_DRAFTED", path: sessionDir(result.session.id) }, true);
      return;
    }
    case "stop": {
      const session = finalizeCapture(positionals[0]);
      if (!session) throw new Error("No RECORDING session found.");
      generateScenario(session.id);
      print({ sessionId: session.id, state: readSession(session.id).state, path: sessionDir(session.id) }, true);
      return;
    }
    case "list-sessions":
      print(listSessions(), true);
      return;
    case "summary": {
      const sessionId = requireArg(positionals[0], "summary requires <session-id>");
      const { content } = generateScenario(sessionId);
      print(content, json);
      return;
    }
    case "step": {
      const sessionId = requireArg(positionals[0], "step requires <session-id> <n>");
      const step = Number(requireArg(positionals[1], "step requires <session-id> <n>"));
      const index = readIndex(sessionId);
      const event = index.events[step - 1];
      if (!event) throw new Error(`No step ${step} in session ${sessionId}.`);
      print(event, true);
      return;
    }
    case "network": {
      const sessionId = requireArg(positionals[0], "network requires <session-id>");
      print(readIndex(sessionId).network, true);
      return;
    }
    case "screenshots": {
      const sessionId = requireArg(positionals[0], "screenshots requires <session-id>");
      print(readIndex(sessionId).screenshots, true);
      return;
    }
    case "selectors": {
      const sessionId = requireArg(positionals[0], "selectors requires <session-id>");
      print(readIndex(sessionId).selectorCandidates, true);
      return;
    }
    case "mark": {
      const sessionId = requireArg(positionals[0], "mark requires <session-id>");
      print(add_intent_marker({
        sessionId,
        type: requireArg(flags.type, "mark requires --type <marker>"),
        note: flags.note || "",
        stepId: flags.step,
      }), true);
      return;
    }
    case "approve-scenario": {
      const session = approveScenario(requireArg(positionals[0], "approve-scenario requires <session-id>"));
      print({ sessionId: session.id, state: session.state }, true);
      return;
    }
    case "coverage-plan": {
      const sessionId = requireArg(positionals[0], "coverage-plan requires <session-id>");
      const { content } = generateCoveragePlan(sessionId);
      print(content, json);
      return;
    }
    case "approve-coverage-plan": {
      const session = approveCoveragePlan(requireArg(positionals[0], "approve-coverage-plan requires <session-id>"));
      print({ sessionId: session.id, state: session.state }, true);
      return;
    }
    case "testability": {
      const sessionId = requireArg(positionals[0], "testability requires <session-id>");
      print(readTextArtifact(sessionId, "testability.md"), json);
      return;
    }
    case "triage": {
      const sessionId = requireArg(positionals[0], "triage requires <session-id>");
      const output = requireArg(flags["test-output"], "triage requires --test-output <file>");
      print(triageSessionFailure({ sessionId, testOutput: output }), true);
      return;
    }
    case "link-test": {
      const sessionId = requireArg(positionals[0], "link-test requires <session-id>");
      print(linkGeneratedTest({
        sessionId,
        file: requireArg(flags.file, "link-test requires --file <path>"),
        command: requireArg(flags.command, "link-test requires --command <cmd>"),
        status: flags.status || "passing",
      }), true);
      return;
    }
    case "ledger":
      print(readLedger(), true);
      return;
    case "clean": {
      if (!flags.yes) throw new Error("clean requires --yes");
      fs.rmSync(sessionRoot(), { recursive: true, force: true });
      print({ cleaned: true }, true);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
}
