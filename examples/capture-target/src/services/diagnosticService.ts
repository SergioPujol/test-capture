import { requestJson } from "./http";

export function triggerSlowRequest() {
  return requestJson<{ ok: true; delayMs: number }>("/api/slow");
}

export function triggerFailedRequest() {
  return requestJson<{ error: string }>("/api/fail");
}
