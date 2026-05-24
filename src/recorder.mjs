import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { captureError, errorNames } from "./errors.mjs";
import { states } from "./states.mjs";
import { sessionDir, updateState, writeCaptureBuffer, writeIndex } from "./session-store.mjs";
import { nowIso } from "./time.mjs";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw captureError(errorNames.BrowserLaunchError, "Playwright is not installed in this project.", {
      operation: "start_capture",
      nextSafeAction: "Install Playwright in the host project, then run `test-capture start --url <url>` again.",
      cause: error.message,
    });
  }
}

function push(capture, bucket, event) {
  capture[bucket].push({ ...event, timestamp: nowIso() });
}

async function maybeScreenshot(page, session, capture, label, cwd = process.cwd()) {
  if (!session.privacy.allowScreenshots) return;
  const rel = path.join("screenshots", `${String(capture.screenshots.length + 1).padStart(4, "0")}.png`);
  const abs = path.join(sessionDir(session.id, cwd), rel);
  await page.screenshot({ path: abs, fullPage: true });
  capture.screenshots.push({ id: `shot-${capture.screenshots.length + 1}`, path: rel, label });
}

export async function assertTargetReachable(url) {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual" });
    return response.status;
  } catch (error) {
    throw captureError(errorNames.TargetUnreachableError, `Target is unreachable: ${url}`, {
      operation: "start_capture",
      nextSafeAction: "Start the local app server, verify the URL, and retry capture.",
      cause: error.message,
    });
  }
}

export async function recordInteractiveCapture(session, { cwd = process.cwd() } = {}) {
  await assertTargetReachable(session.target);
  const playwright = await loadPlaywright();
  const capture = { events: [], network: [], console: [], screenshots: [], humanMarkers: [], uncertainties: [] };
  const userDataDir = path.join(sessionDir(session.id, cwd), "browser-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
    });
  } catch (error) {
    throw captureError(errorNames.BrowserLaunchError, "Could not launch Chromium through Playwright.", {
      sessionId: session.id,
      operation: "start_capture",
      nextSafeAction: "Run `npx playwright install chromium`, then retry capture.",
      cause: error.message,
    });
  }

  const recording = updateState(session.id, states.RECORDING, cwd);
  await context.tracing.start({ screenshots: session.privacy.allowScreenshots, snapshots: true, sources: false });
  await context.exposeBinding("__testCaptureEvent", async (_source, event) => {
    push(capture, "events", event);
  });
  await context.addInitScript(() => {
    const labelFor = (element) => {
      if (!element) return "";
      const aria = element.getAttribute("aria-label");
      if (aria) return aria;
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label?.textContent) return label.textContent.trim();
      }
      return element.innerText || element.textContent || element.getAttribute("placeholder") || element.getAttribute("name") || "";
    };
    const selectorFor = (element) => {
      if (!element) return "";
      if (element.getAttribute("data-testid")) return `[data-testid="${element.getAttribute("data-testid")}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      return element.tagName ? element.tagName.toLowerCase() : "";
    };
    document.addEventListener("click", (event) => {
      const element = event.target;
      window.__testCaptureEvent?.({
        type: "click",
        url: location.href,
        label: labelFor(element).slice(0, 120),
        role: element.getAttribute?.("role") || "",
        selector: selectorFor(element),
      });
    }, true);
    document.addEventListener("input", (event) => {
      const element = event.target;
      window.__testCaptureEvent?.({
        type: "input",
        url: location.href,
        label: labelFor(element).slice(0, 120),
        selector: selectorFor(element),
        value: element.type === "password" ? "[REDACTED]" : element.value,
      });
    }, true);
  });

  const page = context.pages()[0] ?? await context.newPage();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) push(capture, "events", { type: "navigation", url: frame.url() });
  });
  page.on("console", (message) => {
    push(capture, "console", { type: message.type(), message: message.text(), url: page.url() });
  });
  page.on("requestfinished", async (request) => {
    const response = await request.response();
    push(capture, "network", {
      method: request.method(),
      url: request.url(),
      status: response?.status(),
      resourceType: request.resourceType(),
    });
  });
  page.on("requestfailed", (request) => {
    push(capture, "network", {
      method: request.method(),
      url: request.url(),
      status: 0,
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText,
    });
  });

  await page.goto(recording.target, { waitUntil: "domcontentloaded" });
  await maybeScreenshot(page, session, capture, "initial", cwd);
  const rl = readline.createInterface({ input, output });
  await rl.question("Interact with the browser, then press Enter here to stop capture.\n");
  rl.close();
  await maybeScreenshot(page, session, capture, "final", cwd);
  await context.tracing.stop({ path: path.join(sessionDir(session.id, cwd), "trace.zip") });
  await context.close();
  writeCaptureBuffer(session.id, capture, cwd);
  const captured = updateState(session.id, states.CAPTURED, cwd);
  writeIndex(captured, capture, cwd);
  return { session: captured, capture };
}
