import { states } from "./states.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import {
  latestRecordingSession,
  readCaptureBuffer,
  readIndex,
  readSession,
  updateState,
  writeIndex,
  writeJsonArtifact,
  writeSession,
  writeTextArtifact,
} from "./session-store.mjs";
import {
  buildEvidencePack,
  buildTestOutline,
  buildSessionSummaries,
  draftAgentContext,
  draftCoveragePlan,
  draftEvidencePack,
  draftReport,
  draftScenario,
  draftTestOutline,
  draftTestability,
  normalizeEvidenceFact,
} from "./artifacts.mjs";
import { upsertLedgerEntry } from "./ledger.mjs";
import { triageFailure } from "./triage.mjs";
import { captureError, errorNames } from "./errors.mjs";
import { nowIso } from "./time.mjs";

const stateOrder = [
  states.CREATED,
  states.RECORDING,
  states.CAPTURED,
  states.SCENARIO_DRAFTED,
  states.SCENARIO_APPROVED,
  states.COVERAGE_PLANNED,
  states.COVERAGE_APPROVED,
  states.TEST_GENERATED,
  states.TRIAGE_NEEDED,
  states.VERIFIED,
];

function atLeast(state, minimum) {
  return stateOrder.indexOf(state) >= stateOrder.indexOf(minimum);
}

function assertHasEvidence(index, sessionId) {
  if (index.events.length === 0 && index.network.length === 0 && index.console.length === 0 && index.screenshots.length === 0) {
    throw captureError(errorNames.InvalidSessionTransitionError, "Cannot summarize or plan coverage for an empty capture session.", {
      sessionId,
      operation: "summarize_session",
      nextSafeAction: "Run a browser capture with at least one observed navigation, interaction, network event, console event, or screenshot.",
    });
  }
}

function coveragePlanFile(sessionId, cwd = process.cwd()) {
  return path.join(repoRoot(cwd), ".test-capture", "sessions", sessionId, "coverage-plan.md");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function parseCoveragePlanMetadata(content) {
  const rawProposedTestFile = content.match(/## Proposed Test File\s*\n\s*- ([^\n]+)/)?.[1]?.trim() ?? null;
  const proposedTestFile = rawProposedTestFile && !rawProposedTestFile.startsWith("BLOCKED:")
    ? rawProposedTestFile
    : null;
  const assertionsSection = content.match(/## Assertions To Include\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  const assertionIds = [...assertionsSection.matchAll(/^- \[([^\]]+)\]/gm)].map((match) => match[1]);
  return {
    hash: hashContent(content),
    proposedTestFile,
    strategy: content.match(/^- Strategy ID: ([^\n]+)/m)?.[1]?.trim() ?? null,
    strategyLabel: content.match(/^- Strategy: ([^\n]+)/m)?.[1]?.trim() ?? null,
    runnerCommand: content.match(/^- Recommended command: ([^\n]+)/m)?.[1]?.trim() ?? null,
    assertionIds,
  };
}

function readOrWriteCoveragePlan(session, index, cwd = process.cwd()) {
  const file = coveragePlanFile(session.id, cwd);
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : draftCoveragePlan(session, index);
  if (!fs.existsSync(file)) writeTextArtifact(session.id, "coverage-plan.md", content, cwd);
  return { content, ...parseCoveragePlanMetadata(content) };
}

function normalizedGeneratedTests(generatedTests = []) {
  return generatedTests.map((item) => typeof item === "string" ? { file: item } : item);
}

function upsertGeneratedTestLink(existingLinks, link) {
  const links = normalizedGeneratedTests(existingLinks);
  const index = links.findIndex((item) => item.file === link.file);
  if (index >= 0) links[index] = { ...links[index], ...link };
  else links.push(link);
  return links;
}

function inferredLinkedStrategy(file, command = "") {
  const combined = `${file} ${command}`;
  if (/playwright|cypress|(^|\/)e2e\//i.test(combined)) return "browser-e2e";
  if (/jest|vitest|node --test|(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(combined)) return "integration";
  return "unknown";
}

function strategyFamily(strategy) {
  if (strategy === "browser-e2e") return "browser-e2e";
  if (["integration", "state-integration"].includes(strategy)) return "integration";
  return strategy || "unknown";
}

function domainTokens(text = "") {
  return uniq([
    ...String(text).matchAll(/\b[a-z][a-z0-9]*-\d+\b/gi),
    ...String(text).matchAll(/\b\d+[a-z]*-[a-z0-9]+\b/gi),
  ].map((match) => match[0]));
}

function normalizedText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[`"'()[\]{}.,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMaskedValue(value = "") {
  return /^\[(?:masked|redacted|not_persisted)\]$/i.test(String(value).trim());
}

function isSelectorLike(value = "") {
  return /^(#|\.|\[|\/|https?:|data:|aria-|css=|xpath=)|\.(?:js|ts|tsx|jsx|mjs|json|css)$|^(button|link|textbox|combobox|heading)$/i.test(String(value).trim());
}

function looksLikeBusinessLiteral(value = "") {
  const trimmed = String(value).trim();
  if (trimmed.length < 3 || trimmed.length > 160) return false;
  if (isSelectorLike(trimmed)) return false;
  if (domainTokens(trimmed).length) return true;
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(trimmed)) return true;
  if (/\b(node|name|title|label|email|code|status|value|customer|account|billing|invoice|order|user|project|diagram|canvas|flow|memo|token)\b/i.test(trimmed)) return true;
  return /\s/.test(trimmed) && /\b(saved|updated|created|deleted|captured|renamed|selected|completed|failed|success)\b/i.test(trimmed);
}

function addLiteral(literals, value, context, required = true) {
  const literal = String(value ?? "").trim();
  if (!literal || isMaskedValue(literal)) return;
  const key = `${context}:${literal}`;
  if (literals.some((item) => item.key === key)) return;
  literals.push({ key, value: literal, context, required });
}

function extractLinkedTestLiterals(content = "") {
  const literals = [];
  const contextualPatterns = [
    { context: "fill()", regex: /\.\s*fill\s*\(\s*(['"`])([^'"`\n]{1,200})\1/gi },
    { context: "toHaveValue()", regex: /\.\s*toHaveValue\s*\(\s*(['"`])([^'"`\n]{1,200})\1/gi },
    { context: "getByText()", regex: /\bgetByText\s*\(\s*(['"`])([^'"`\n]{1,200})\1/gi },
    { context: "text assertion", regex: /\.(?:toHaveText|toContainText)\s*\(\s*(['"`])([^'"`\n]{1,200})\1/gi },
    { context: "value assertion", regex: /\.(?:toEqual|toBe|toContain|toMatch)\s*\(\s*(['"`])([^'"`\n]{1,200})\1/gi },
  ];
  for (const { context, regex } of contextualPatterns) {
    for (const match of content.matchAll(regex)) addLiteral(literals, match[2], context);
  }
  for (const match of content.matchAll(/\bgetByRole\s*\(([\s\S]{0,320}?)\)/gi)) {
    const name = match[1].match(/\bname\s*:\s*(['"`])([^'"`\n]{1,200})\1/i);
    if (name) addLiteral(literals, name[2], "getByRole({ name })");
  }
  for (const match of content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]{1,200})\2/g)) {
    if (/(?:id|name|title|label|text|code|value|email|status|node|customer|account)$/i.test(match[1]) || looksLikeBusinessLiteral(match[3])) {
      addLiteral(literals, match[3], `constant ${match[1]}`);
    }
  }
  for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*(?:Id|Name|Title|Label|Text|Code|Value|Email|Status)|id|name|title|label|text|code|value|email|status)\s*:\s*(['"`])([^'"`\n]{1,200})\2/gi)) {
    addLiteral(literals, match[3], `property ${match[1]}`);
  }
  for (const match of content.matchAll(/(['"`])([^'"`\n]{3,160})\1/g)) {
    if (looksLikeBusinessLiteral(match[2])) addLiteral(literals, match[2], "business literal", false);
  }
  return literals.map(({ key: _key, ...item }) => item);
}

function evidenceTextBlobs({ pack, index }) {
  const usableFacts = pack.facts.filter((fact) => !fact.requiresApproval || fact.approvedAt);
  return [
    ...usableFacts.map((fact) => fact.fact),
    ...usableFacts.flatMap((fact) => fact.source ?? []),
    ...pack.selectorRecommendations.flatMap((item) => [item.selector, item.element, item.recommendedLocator]),
    ...(index.events ?? []).flatMap((event) => [event.label, event.selector, event.text].filter(Boolean)),
    ...(index.network ?? []).flatMap((event) => [event.url, event.method].filter(Boolean)),
  ].map(normalizedText).filter(Boolean);
}

function literalIsGrounded(literal, blobs) {
  const normalized = normalizedText(literal);
  if (!normalized) return true;
  return blobs.some((blob) => blob.includes(normalized));
}

function observedValuesToPreserve({ pack, index }) {
  const usableFacts = pack.facts.filter((fact) => !fact.requiresApproval || fact.approvedAt);
  const values = [];
  for (const fact of usableFacts.filter((item) => ["observed", "inferred"].includes(item.classification))) {
    for (const token of domainTokens(fact.fact)) values.push(token);
  }
  for (const event of index.events ?? []) {
    if (event.type === "input" && event.value && !isMaskedValue(event.value)) values.push(event.value);
    if (event.type === "text" && event.text) values.push(event.text);
  }
  return uniq(values.map((value) => String(value).trim()).filter((value) => value.length >= 3));
}

function usesRawCanvasReplay(content = "") {
  return /(?:locator|\$|waitForSelector)\s*\(\s*(['"`])canvas\1|canvas[^\n]{0,80}\.(?:click|dispatchEvent)|\.\s*click\s*\([^)]*position\s*:/i.test(content);
}

function validateLinkedTestEvidence({ session, index, file, deviationReason, linkedStrategy, cwd = process.cwd() }) {
  const root = repoRoot(cwd);
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const pack = buildEvidencePack(session, index);
  const outline = buildTestOutline(session, index);
  const usableFacts = pack.facts.filter((fact) => !fact.requiresApproval || fact.approvedAt);
  const evidenceTokens = uniq(usableFacts.flatMap((fact) => domainTokens(fact.fact)));
  const testTokens = uniq(domainTokens(content));
  const literals = extractLinkedTestLiterals(content);
  const groundedBlobs = evidenceTextBlobs({ pack, index });
  const unexpectedLiterals = literals
    .filter((literal) => literal.required || looksLikeBusinessLiteral(literal.value))
    .filter((literal) => !literalIsGrounded(literal.value, groundedBlobs));
  const unexpectedDomainTokens = testTokens.filter((token) => !evidenceTokens.includes(token));
  const observedValues = observedValuesToPreserve({ pack, index });
  const missingObservedValues = observedValues.filter((value) => !content.includes(value));
  const rawCanvasReplay = linkedStrategy === "browser-e2e"
    && outline.allowedMechanics.automationBlockers.some((item) => /canvas|svg/i.test(item.selector || item.reason))
    && usesRawCanvasReplay(content);
  const errors = [
    ...(!deviationReason && unexpectedDomainTokens.length
      ? [`Linked test uses domain value(s) not present in approved evidence: ${unexpectedDomainTokens.join(", ")}`]
      : []),
    ...(!deviationReason && unexpectedLiterals.length
      ? [`Linked test uses unapproved business literal(s): ${unexpectedLiterals.map((item) => `${item.value} (${item.context})`).join(", ")}`]
      : []),
    ...(rawCanvasReplay
      ? ["Linked browser test replays raw canvas/SVG mechanics even though the evidence outline requires instrumentation or lower-level coverage."]
      : []),
  ];
  const warnings = [
    ...missingObservedValues.map((value) => `Observed evidence value ${value} is not used by the linked test.`),
    ...((unexpectedDomainTokens.length || unexpectedLiterals.length) && deviationReason
      ? [`Linked test uses substituted value(s) not found in evidence. Deviation reason recorded: ${deviationReason}`]
      : []),
  ];
  return {
    status: errors.length ? "failed" : unexpectedDomainTokens.length || unexpectedLiterals.length || warnings.length ? "warning" : "passed",
    evidencePack: "evidence-pack.json",
    testOutline: "test-outline.json",
    observedDomainTokens: evidenceTokens,
    observedValues,
    linkedTestDomainTokens: testTokens,
    linkedTestLiterals: literals,
    missingObservedTokens: missingObservedValues,
    missingObservedValues,
    unexpectedDomainTokens,
    unexpectedLiterals,
    rawCanvasReplay,
    errors,
    warnings,
    validatedAt: nowIso(),
  };
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

export function writeSessionSummaries(session, index, cwd = process.cwd()) {
  const summaries = buildSessionSummaries(session, index);
  writeJsonArtifact(session.id, "event-summary.json", summaries.eventSummary, cwd);
  writeJsonArtifact(session.id, "network-summary.json", summaries.networkSummary, cwd);
  writeJsonArtifact(session.id, "console-summary.json", summaries.consoleSummary, cwd);
  writeJsonArtifact(session.id, "testability-summary.json", summaries.testabilitySummary, cwd);
  writeJsonArtifact(session.id, "evidence-pack.json", summaries.evidencePack, cwd);
  writeTextArtifact(session.id, "evidence-pack.md", draftEvidencePack(session, index), cwd);
  writeTextArtifact(session.id, "report.md", draftReport(session, index), cwd);
  return summaries;
}

export function finalizeCapture(sessionId, cwd = process.cwd()) {
  const session = sessionId ? readSession(sessionId, cwd) : latestRecordingSession(cwd);
  if (!session) return null;
  const captured = session.state === states.RECORDING
    ? updateState(session.id, states.CAPTURED, cwd)
    : session;
  const capture = readCaptureBuffer(captured.id, cwd);
  const index = writeIndex(captured, capture, cwd);
  writeSessionSummaries(captured, index, cwd);
  writeTextArtifact(captured.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(captured.id, "agent-context.md", draftAgentContext(captured, index), cwd);
  return captured;
}

export function generateScenario(sessionId, cwd = process.cwd()) {
  let session = readSession(sessionId, cwd);
  if (session.state === states.RECORDING) session = finalizeCapture(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  if (session.state === states.CAPTURED) session = updateState(session.id, states.SCENARIO_DRAFTED, cwd);
  const content = draftScenario(session, index);
  writeSessionSummaries(session, index, cwd);
  writeTextArtifact(session.id, "scenario.md", content, cwd);
  writeTextArtifact(session.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session: readSession(session.id, cwd), content };
}

export function approveScenario(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  return updateState(session.id, states.SCENARIO_APPROVED, cwd);
}

export function generateCoveragePlan(sessionId, cwd = process.cwd()) {
  let session = readSession(sessionId, cwd);
  if (session.state === states.CAPTURED) {
    generateScenario(session.id, cwd);
    session = readSession(session.id, cwd);
  }
  if (session.state === states.SCENARIO_DRAFTED) {
    throw captureError(errorNames.InvalidSessionTransitionError, "Scenario must be approved before coverage planning.", {
      sessionId: session.id,
      operation: "get_coverage_plan",
      nextSafeAction: `Run: test-capture approve-scenario ${session.id}`,
    });
  }
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  if (session.state === states.SCENARIO_APPROVED) session = updateState(session.id, states.COVERAGE_PLANNED, cwd);
  const content = draftCoveragePlan(session, index);
  writeSessionSummaries(session, index, cwd);
  writeTextArtifact(session.id, "coverage-plan.md", content, cwd);
  writeTextArtifact(session.id, "testability.md", draftTestability(index), cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session: readSession(session.id, cwd), content };
}

export function generateEvidencePack(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  const pack = buildEvidencePack(session, index);
  writeJsonArtifact(session.id, "evidence-pack.json", pack, cwd);
  const content = draftEvidencePack(session, index);
  writeTextArtifact(session.id, "evidence-pack.md", content, cwd);
  writeTextArtifact(session.id, "agent-context.md", draftAgentContext(session, index), cwd);
  return { session, pack, content };
}

export function generateTestOutline(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  generateEvidencePack(session.id, cwd);
  const outline = buildTestOutline(session, index);
  writeJsonArtifact(session.id, "test-outline.json", outline, cwd);
  const content = draftTestOutline(session, index);
  writeTextArtifact(session.id, "test-outline.md", content, cwd);
  return { session, outline, content };
}

export function addEvidenceFact({ sessionId, fact, source, classification, requiresApproval = false, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const evidenceFact = normalizeEvidenceFact({
    fact,
    source,
    classification,
    requiresApproval,
  });
  const evidenceFacts = [...(session.evidenceFacts ?? []), evidenceFact];
  const updated = writeSession({ ...session, evidenceFacts, updatedAt: nowIso() }, cwd);
  const index = readIndex(session.id, cwd);
  generateEvidencePack(updated.id, cwd);
  writeJsonArtifact(updated.id, "test-outline.json", buildTestOutline(updated, index), cwd);
  writeTextArtifact(updated.id, "test-outline.md", draftTestOutline(updated, index), cwd);
  return { session: updated, fact: evidenceFact };
}

export function approveEvidenceFact({ sessionId, factId, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const manualFacts = session.evidenceFacts ?? [];
  const factIndex = manualFacts.findIndex((fact) => fact.id === factId);
  if (factIndex < 0) {
    const index = readIndex(session.id, cwd);
    const generatedFact = buildEvidencePack(session, index).facts.find((fact) => fact.id === factId);
    const nextSafeAction = generatedFact?.requiresApproval
      ? "Screenshot-derived generated facts are references only. Add a confirmed observed fact with evidence-add instead of approving the screenshot reference itself."
      : "List the evidence pack and choose a manual evidence fact id that requires approval.";
    throw captureError(errorNames.LedgerConsistencyError, `No approvable manual evidence fact found: ${factId}`, {
      sessionId: session.id,
      operation: "approve_evidence_fact",
      nextSafeAction,
    });
  }
  const evidenceFacts = manualFacts.map((fact, index) => index === factIndex
    ? { ...fact, approvedAt: fact.approvedAt || nowIso() }
    : fact);
  const updated = writeSession({ ...session, evidenceFacts, updatedAt: nowIso() }, cwd);
  const index = readIndex(session.id, cwd);
  generateEvidencePack(updated.id, cwd);
  writeJsonArtifact(updated.id, "test-outline.json", buildTestOutline(updated, index), cwd);
  writeTextArtifact(updated.id, "test-outline.md", draftTestOutline(updated, index), cwd);
  return { session: updated, fact: evidenceFacts[factIndex] };
}

export function approveCoveragePlan(sessionId, cwd = process.cwd()) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(session.id, cwd);
  assertHasEvidence(index, session.id);
  const coveragePlan = readOrWriteCoveragePlan(session, index, cwd);
  return updateState(session.id, states.COVERAGE_APPROVED, cwd, { coveragePlan });
}

export function linkGeneratedTest({ sessionId, file, command, status = "passing", deviationReason, cwd = process.cwd() }) {
  let session = readSession(sessionId, cwd);
  if (!atLeast(session.state, states.COVERAGE_APPROVED)) {
    throw captureError(errorNames.InvalidSessionTransitionError, "Coverage plan must be approved before linking generated tests.", {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Run: test-capture approve-coverage-plan ${session.id}`,
    });
  }
  if (!["passing", "failing"].includes(status)) {
    throw captureError(errorNames.LedgerConsistencyError, `Unsupported verification status: ${status}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: "Use --status passing or --status failing.",
    });
  }
  if (!fs.existsSync(path.join(repoRoot(cwd), file))) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test file does not exist: ${file}`, {
      sessionId: session.id,
      operation: "update_ledger",
      nextSafeAction: "Create the linked test file or choose the correct relative test path.",
    });
  }
  const index = readIndex(session.id, cwd);
  const coveragePlan = session.coveragePlan ?? readOrWriteCoveragePlan(session, index, cwd);
  if (coveragePlan.proposedTestFile && file !== coveragePlan.proposedTestFile && !deviationReason) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test file differs from approved coverage plan: ${file}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Use the approved path ${coveragePlan.proposedTestFile}, or pass --deviation-reason to explain the different file.`,
    });
  }
  const linkedStrategy = inferredLinkedStrategy(file, command);
  if (coveragePlan.strategy && strategyFamily(coveragePlan.strategy) !== strategyFamily(linkedStrategy) && !deviationReason) {
    throw captureError(errorNames.LedgerConsistencyError, `Linked test strategy differs from approved coverage plan: ${linkedStrategy}`, {
      sessionId: session.id,
      operation: "link_generated_test",
      nextSafeAction: `Use the approved strategy ${coveragePlan.strategy}, or pass --deviation-reason to explain the different test shape.`,
    });
  }
  const evidenceValidation = validateLinkedTestEvidence({ session, index, file, deviationReason, linkedStrategy, cwd });
  const link = {
    file,
    status: evidenceValidation.status === "failed" ? "blocked" : status,
    command,
    coveragePlanHash: coveragePlan.hash,
    assertionIds: coveragePlan.assertionIds,
    strategy: coveragePlan.strategy,
    strategyLabel: coveragePlan.strategyLabel,
    linkedStrategy,
    deviationReason: deviationReason || null,
    evidenceValidation,
    linkedAt: nowIso(),
  };
  const generatedTests = upsertGeneratedTestLink(session.generatedTests, link);
  if (evidenceValidation.status === "failed") {
    const blockedVerification = {
      status: "blocked",
      command,
      coveragePlanHash: coveragePlan.hash,
      assertionIds: coveragePlan.assertionIds,
      strategy: coveragePlan.strategy,
      linkedStrategy,
      evidenceValidation,
      verifiedAt: link.linkedAt,
    };
    const blockedSession = writeSession({
      ...session,
      generatedTests,
      coveragePlan,
      verification: blockedVerification,
      updatedAt: nowIso(),
    }, cwd);
    upsertLedgerEntry({
      session: blockedSession,
      generatedTests,
      status: "blocked",
      command,
    }, cwd);
    throw captureError(errorNames.LedgerConsistencyError, evidenceValidation.errors[0], {
      sessionId: session.id,
      operation: "validate_linked_test_evidence",
      nextSafeAction: "Update the test to use observed evidence values, add confirmed evidence with evidence-add, choose lower-level coverage, or pass --deviation-reason for intentional substitutions that are not raw canvas replay.",
    });
  }
  const verification = {
    status,
    command,
    coveragePlanHash: coveragePlan.hash,
    assertionIds: coveragePlan.assertionIds,
    strategy: coveragePlan.strategy,
    linkedStrategy,
    evidenceValidation,
    verifiedAt: link.linkedAt,
  };
  if (session.state === states.COVERAGE_APPROVED) {
    session = updateState(session.id, states.TEST_GENERATED, cwd, { generatedTests, coveragePlan });
  }
  if (session.state === states.TRIAGE_NEEDED) {
    session = updateState(session.id, states.TEST_GENERATED, cwd, { generatedTests, coveragePlan });
  }
  const verifiedState = status === "passing" ? states.VERIFIED : states.TRIAGE_NEEDED;
  if (session.state !== verifiedState) {
    session = updateState(session.id, verifiedState, cwd, {
      generatedTests,
      coveragePlan,
      verification,
    });
  } else {
    session = writeSession({ ...session, generatedTests, coveragePlan, verification }, cwd);
  }
  const entry = upsertLedgerEntry({
    session,
    generatedTests,
    status,
    command,
  }, cwd);
  return { session, entry };
}

export function triageSessionFailure({ sessionId, testOutput, cwd = process.cwd() }) {
  const session = readSession(sessionId, cwd);
  const index = readIndex(sessionId, cwd);
  return triageFailure({ session, index, testOutput });
}
