import path from "node:path";
import { provenance, schemaVersion } from "./provenance.mjs";
import { redactEvent, redactText, redactionSummary } from "./privacy.mjs";

function selectorQuality(selector) {
  if (!selector) return "unknown";
  if (/getBy(Role|Label|Text|TestId)|\[data-testid=/.test(selector)) return "preferred";
  if (/^#[A-Za-z][\w-]*$/.test(selector)) return "usable";
  if (/canvas|svg|nth-child| > |\.css-|:has\(/i.test(selector)) return "brittle";
  return "review";
}

export function buildAgentSafeIndex(session, capture = {}) {
  const events = (capture.events ?? []).map((event, index) => {
    const redacted = redactEvent(event, session.privacy ?? {});
    return {
      id: redacted.id ?? `evt-${String(index + 1).padStart(4, "0")}`,
      type: redacted.type ?? "unknown",
      timestamp: redacted.timestamp,
      url: redacted.url,
      label: redacted.label,
      labelSource: redacted.labelSource,
      role: redacted.role,
      selector: redacted.selector,
      selectorQuality: selectorQuality(redacted.selector),
      value: redacted.value,
      text: redacted.text,
      provenance: provenance.toolGenerated,
    };
  });
  const network = (capture.network ?? []).map((event, index) => {
    const redacted = redactEvent(event, session.privacy ?? {});
    return {
      id: redacted.id ?? `net-${String(index + 1).padStart(4, "0")}`,
      method: redacted.method,
      url: redacted.url,
      status: redacted.status,
      resourceType: redacted.resourceType,
      durationMs: redacted.durationMs,
      provenance: provenance.toolGenerated,
    };
  });
  const consoleEvents = (capture.console ?? []).map((event, index) => {
    const redacted = redactEvent(event, session.privacy ?? {});
    return {
      id: redacted.id ?? `con-${String(index + 1).padStart(4, "0")}`,
      type: redacted.type ?? "log",
      message: redacted.message,
      url: redacted.url,
      provenance: provenance.toolGenerated,
    };
  });
  const screenshots = (capture.screenshots ?? []).map((artifact, index) => ({
    id: artifact.id ?? `shot-${String(index + 1).padStart(4, "0")}`,
    path: artifact.path,
    label: artifact.label,
    sensitive: true,
    provenance: provenance.toolGenerated,
  }));
  const selectorCandidates = [...new Set(events.map((event) => event.selector).filter(Boolean))].map((selector) => ({
    selector,
    quality: selectorQuality(selector),
    provenance: provenance.toolGenerated,
  }));

  return {
    schemaVersion,
    sessionId: session.id,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    target: session.target,
    description: session.description,
    repo: session.repo,
    redaction: redactionSummary(session.privacy),
    artifacts: {
      session: "session.json",
      agentContext: "agent-context.md",
      scenario: "scenario.md",
      coveragePlan: "coverage-plan.md",
      testability: "testability.md",
      report: "report.md",
      eventSummary: "event-summary.json",
      networkSummary: "network-summary.json",
      consoleSummary: "console-summary.json",
      testabilitySummary: "testability-summary.json",
      network: "network.har",
      console: "console.log",
      screenshots: path.join("screenshots"),
      trace: session.privacy?.allowTrace ? "trace.zip" : null,
    },
    events,
    network,
    console: consoleEvents,
    screenshots,
    selectorCandidates,
    humanMarkers: (capture.humanMarkers ?? []).map((marker) => ({
      ...marker,
      note: redactText(marker.note ?? ""),
    })),
    uncertainties: capture.uncertainties ?? [],
    provenance: provenance.toolGenerated,
  };
}
