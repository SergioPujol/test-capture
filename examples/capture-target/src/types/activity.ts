export type ActivitySeverity = "info" | "warning" | "critical";

export type ActivityItem = {
  id: string;
  actor: string;
  action: string;
  target: string;
  severity: ActivitySeverity;
  createdAt: string;
};
