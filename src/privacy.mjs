import { captureError, errorNames } from "./errors.mjs";

const secretHeaderPattern = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
const secretKeyPattern = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|session|cookie|authorization|private|memo|code)/i;
const urlSecretPattern = /([?&](?:token|key|secret|password|code|auth|session)[^=]*=)[^&#]*/gi;

export const privacyModes = {
  strict: "strict",
  standard: "standard",
};

export function normalizePrivacyOptions(privacy = {}) {
  return {
    allowScreenshots: Boolean(privacy.allowScreenshots ?? privacy.screenshots),
    allowNetworkBodies: Boolean(privacy.allowNetworkBodies ?? privacy.networkBodies),
    allowTypedText: Boolean(privacy.allowTypedText ?? privacy.typedText),
    allowTrace: Boolean(privacy.allowTrace ?? privacy.trace),
    preserveProfile: Boolean(privacy.preserveProfile),
  };
}

function redactionOptionsFromPrivacy(privacy = {}) {
  const normalized = normalizePrivacyOptions(privacy);
  return { allowSensitiveValues: normalized.allowTypedText };
}

export function redactText(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(urlSecretPattern, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9._~+/=-]+/gi, "Basic [REDACTED]")
    .replace(/([A-Za-z0-9_]*token[A-Za-z0-9_]*\s*[:=]\s*)["']?[^"',\s]+/gi, "$1[REDACTED]")
    .replace(/([A-Za-z0-9_]*password[A-Za-z0-9_]*\s*[:=]\s*)["']?[^"',\s]+/gi, "$1[REDACTED]");
}

export function redactUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (secretKeyPattern.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    return parsed.toString();
  } catch {
    return redactText(rawUrl);
  }
}

export function redactHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = secretHeaderPattern.test(key) ? "[REDACTED]" : redactText(value);
  }
  return result;
}

export function redactValue(key, value, { allowSensitiveValues = false } = {}) {
  if (key && secretKeyPattern.test(key)) return "[REDACTED]";
  if (!allowSensitiveValues && typeof value === "string" && value.length > 0) return "[MASKED]";
  return redactText(value);
}

export function redactEvent(event, options = {}) {
  try {
    const redacted = { ...event };
    const redactionOptions = options.allowSensitiveValues === undefined
      ? redactionOptionsFromPrivacy(options)
      : options;
    if (Object.hasOwn(redacted, "url")) redacted.url = redactUrl(redacted.url);
    if (Object.hasOwn(redacted, "text")) redacted.text = redactValue(redacted.label ?? "typed_text", redacted.text, redactionOptions);
    if (Object.hasOwn(redacted, "value")) redacted.value = redactValue(redacted.label ?? "value", redacted.value, redactionOptions);
    if (redacted.headers) redacted.headers = redactHeaders(redacted.headers);
    if (redacted.requestHeaders) redacted.requestHeaders = redactHeaders(redacted.requestHeaders);
    if (redacted.responseHeaders) redacted.responseHeaders = redactHeaders(redacted.responseHeaders);
    if (Object.hasOwn(redacted, "message")) redacted.message = redactText(redacted.message);
    if (Object.hasOwn(redacted, "failure")) redacted.failure = redactText(redacted.failure);
    for (const key of ["body", "postData", "requestBody", "responseBody"]) {
      if (Object.hasOwn(redacted, key)) redacted[key] = redactValue(key, redacted[key], redactionOptions);
    }
    return redacted;
  } catch (error) {
    throw captureError(errorNames.RedactionFailedError, "Could not redact capture data safely.", {
      operation: "redact_capture_data",
      nextSafeAction: "Retry with strict privacy settings or remove the unsafe event.",
      cause: error.message,
    });
  }
}

export function sanitizeCaptureForPersistence(session = {}, capture = {}) {
  const privacy = normalizePrivacyOptions(session.privacy ?? session);
  const redactionOptions = redactionOptionsFromPrivacy(privacy);
  const sanitizeBodyFields = (event) => {
    const sanitized = redactEvent(event, redactionOptions);
    if (!privacy.allowNetworkBodies) {
      for (const key of ["body", "postData", "requestBody", "responseBody"]) {
        if (Object.hasOwn(sanitized, key)) sanitized[key] = "[NOT_PERSISTED]";
      }
    }
    return sanitized;
  };

  return {
    events: (capture.events ?? []).map((event) => redactEvent(event, redactionOptions)),
    network: (capture.network ?? []).map(sanitizeBodyFields),
    console: (capture.console ?? []).map((event) => redactEvent(event, redactionOptions)),
    screenshots: (capture.screenshots ?? []).map((artifact) => ({
      ...artifact,
      sensitive: true,
    })),
    humanMarkers: (capture.humanMarkers ?? []).map((marker) => ({
      ...marker,
      note: redactText(marker.note ?? ""),
    })),
    uncertainties: (capture.uncertainties ?? []).map((message) => redactText(message)),
  };
}

export function redactionSummary(privacy = {}) {
  const normalized = normalizePrivacyOptions(privacy);
  return {
    mode: privacyModes.strict,
    secretsPersisted: false,
    screenshotsMayContainSensitiveData: Boolean(normalized.allowScreenshots),
    networkBodiesPersisted: Boolean(normalized.allowNetworkBodies),
    typedTextPersisted: Boolean(normalized.allowTypedText),
    tracePersisted: Boolean(normalized.allowTrace),
    browserProfilePersisted: Boolean(normalized.preserveProfile),
    rules: [
      "cookies, authorization headers, tokens, passwords, and API keys are redacted",
      "typed values are masked unless explicitly enabled for a session",
      "query parameters with secret-like names are redacted",
      "request and response bodies are not persisted by default",
    ],
  };
}
