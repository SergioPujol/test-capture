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

async function installPageCapture(context, page, capture) {
  await context.exposeBinding("__testCaptureEvent", async (_source, event) => {
    push(capture, "events", event);
  });
  await context.addInitScript(() => {
    const labelFor = (element) => {
      if (!element) return { text: "", source: "none" };
      const aria = element.getAttribute("aria-label");
      if (aria) return { text: aria, source: "aria-label" };
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label?.textContent) return { text: label.textContent.trim(), source: "label" };
      }
      const text = element.innerText || element.textContent;
      if (text) return { text, source: "text" };
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) return { text: placeholder, source: "placeholder" };
      const name = element.getAttribute("name");
      if (name) return { text: name, source: "name" };
      return { text: "", source: "none" };
    };
    const selectorFor = (element) => {
      if (!element) return "";
      if (element.getAttribute("data-testid")) return `[data-testid="${element.getAttribute("data-testid")}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      return element.tagName ? element.tagName.toLowerCase() : "";
    };
    document.addEventListener("click", (event) => {
      const element = event.target;
      const label = labelFor(element);
      window.__testCaptureEvent?.({
        type: "click",
        url: location.href,
        label: label.text.slice(0, 120),
        labelSource: label.source,
        role: element.getAttribute?.("role") || "",
        selector: selectorFor(element),
      });
    }, true);
    document.addEventListener("input", (event) => {
      const element = event.target;
      const label = labelFor(element);
      window.__testCaptureEvent?.({
        type: "input",
        url: location.href,
        label: label.text.slice(0, 120),
        labelSource: label.source,
        selector: selectorFor(element),
        value: element.type === "password" ? "[REDACTED]" : element.value,
      });
    }, true);
  });

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
}

async function maybeScreenshot(page, session, capture, label, cwd = process.cwd()) {
  if (!session.privacy.allowScreenshots) return;
  const rel = path.join("screenshots", `${String(capture.screenshots.length + 1).padStart(4, "0")}.png`);
  const abs = path.join(sessionDir(session.id, cwd), rel);
  try {
    await page.screenshot({ path: abs, fullPage: false });
    capture.screenshots.push({ id: `shot-${capture.screenshots.length + 1}`, path: rel, label });
  } catch (error) {
    capture.uncertainties.push(`Screenshot "${label}" could not be captured: ${error.message}`);
  }
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

  const page = context.pages()[0] ?? await context.newPage();
  await installPageCapture(context, page, capture);

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

async function runScriptStep(page, step, capture) {
  switch (step.action) {
    case "goto":
      await page.goto(step.url, { waitUntil: step.waitUntil ?? "domcontentloaded" });
      return;
    case "click":
      await page.locator(step.selector).click();
      return;
    case "fill":
      await page.locator(step.selector).fill(step.value ?? "");
      return;
    case "select":
      await page.locator(step.selector).selectOption(step.value);
      return;
    case "press":
      await page.locator(step.selector).press(step.key);
      return;
    case "wait":
      await page.waitForTimeout(step.ms ?? 250);
      return;
    case "waitForSelector":
      await page.locator(step.selector).waitFor({ state: step.state ?? "visible" });
      return;
    case "waitForText":
      await page.getByText(step.text, { exact: Boolean(step.exact) }).waitFor({ state: "visible" });
      return;
    case "marker":
      capture.humanMarkers.push({
        id: `marker-${capture.humanMarkers.length + 1}`,
        type: step.type,
        note: step.note ?? "",
        stepId: step.stepId,
        timestamp: nowIso(),
        provenance: "human_approved",
      });
      return;
    default:
      throw new Error(`Unsupported scripted capture action: ${step.action}`);
  }
}

export async function recordScriptedCapture(session, script, { cwd = process.cwd(), headed = false } = {}) {
  await assertTargetReachable(session.target);
  const playwright = await loadPlaywright();
  const capture = { events: [], network: [], console: [], screenshots: [], humanMarkers: [], uncertainties: [] };
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: !headed });
  } catch (error) {
    throw captureError(errorNames.BrowserLaunchError, "Could not launch Chromium through Playwright.", {
      sessionId: session.id,
      operation: "scripted_capture",
      nextSafeAction: "Run `npx playwright install chromium`, then retry scripted capture.",
      cause: error.message,
    });
  }

  const recording = updateState(session.id, states.RECORDING, cwd);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.tracing.start({ screenshots: session.privacy.allowScreenshots, snapshots: true, sources: false });
  const page = await context.newPage();
  await installPageCapture(context, page, capture);
  await page.goto(recording.target, { waitUntil: "domcontentloaded" });
  await maybeScreenshot(page, session, capture, "initial", cwd);

  for (const step of script.steps ?? script) {
    await runScriptStep(page, step, capture);
    if (step.screenshot) await maybeScreenshot(page, session, capture, step.screenshot, cwd);
  }

  await page.waitForTimeout(script.settleMs ?? 500);
  await maybeScreenshot(page, session, capture, "final", cwd);
  await context.tracing.stop({ path: path.join(sessionDir(session.id, cwd), "trace.zip") });
  await context.close();
  await browser.close();
  writeCaptureBuffer(session.id, capture, cwd);
  const captured = updateState(session.id, states.CAPTURED, cwd);
  writeIndex(captured, capture, cwd);
  return { session: captured, capture };
}
