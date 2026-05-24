import { captureError, errorNames } from "./errors.mjs";

const secretHeaderPattern = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
const secretKeyPattern = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|session|cookie|authorization)/i;
const urlSecretPattern = /([?&](?:token|key|secret|password|code|auth|session)[^=]*=)[^&#]*/gi;

export const privacyModes = {
  strict: "strict",
  standard: "standard",
};

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
    if (redacted.url) redacted.url = redactUrl(redacted.url);
    if (redacted.text) redacted.text = redactValue(redacted.label ?? "typed_text", redacted.text, options);
    if (redacted.value) redacted.value = redactValue(redacted.label ?? "value", redacted.value, options);
    if (redacted.headers) redacted.headers = redactHeaders(redacted.headers);
    if (redacted.requestHeaders) redacted.requestHeaders = redactHeaders(redacted.requestHeaders);
    if (redacted.responseHeaders) redacted.responseHeaders = redactHeaders(redacted.responseHeaders);
    if (redacted.message) redacted.message = redactText(redacted.message);
    return redacted;
  } catch (error) {
    throw captureError(errorNames.RedactionFailedError, "Could not redact capture data safely.", {
      operation: "redact_capture_data",
      nextSafeAction: "Retry with strict privacy settings or remove the unsafe event.",
      cause: error.message,
    });
  }
}

export function redactionSummary({ screenshots = false, networkBodies = false, typedText = false } = {}) {
  return {
    mode: privacyModes.strict,
    secretsPersisted: false,
    screenshotsMayContainSensitiveData: Boolean(screenshots),
    networkBodiesPersisted: Boolean(networkBodies),
    typedTextPersisted: Boolean(typedText),
    rules: [
      "cookies, authorization headers, tokens, passwords, and API keys are redacted",
      "typed values are masked unless explicitly enabled for a session",
      "query parameters with secret-like names are redacted",
      "request and response bodies are not persisted by default",
    ],
  };
}
