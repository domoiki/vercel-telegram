/** Shared health vocabulary. Kept dependency-free so client components can use it. */
export type HealthState = "ok" | "warn" | "error" | "unknown";

export const HEALTH_LABEL: Record<HealthState, string> = {
  ok: "Healthy",
  warn: "Attention",
  error: "Problem",
  unknown: "Unknown",
};
