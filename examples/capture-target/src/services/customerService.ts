import { requestJson } from "./http";
import type { Customer, CustomerUpdate } from "../types/customer";

export function getCustomer() {
  return requestJson<Customer>("/api/customer");
}

export function updateCustomer(update: CustomerUpdate) {
  return requestJson<Customer>("/api/customer", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function loginForRedactionDemo(credentials: { email: string; password: string; accessToken: string }) {
  return requestJson<{ ok: true; role: string; sessionToken: string }>("/api/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function hitPrivateEndpoint(token: string) {
  return requestJson<{ ok: true; message: string }>(`/api/private?token=${encodeURIComponent(token)}`);
}
