import { requestJson } from "./http";
import type { ActivityItem } from "../types/activity";

export function listActivity(query: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ items: ActivityItem[] }>(`/api/activity${suffix}`);
}
