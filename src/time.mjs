export function nowIso() {
  return new Date().toISOString();
}

export function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
