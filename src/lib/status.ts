import type { Tone } from "@/components/ui/badge";
import type {
  AttemptOutcome,
  ErrorCategory,
  LogLevel,
  MessageDirection,
  MessageStatus,
  RequestStatus,
} from "@/lib/db/schema";
import type { HealthState } from "@/lib/health-types";

export function messageTone(status: MessageStatus): Tone {
  switch (status) {
    case "delivered":
      return "success";
    case "failed":
      return "error";
    case "processing":
      return "info";
    case "received":
      return "accent";
    default:
      return "neutral";
  }
}

export function requestTone(status: RequestStatus): Tone {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    default:
      return "info";
  }
}

export function attemptTone(outcome: AttemptOutcome): Tone {
  return outcome === "success" ? "success" : "error";
}

export function healthTone(state: HealthState): Tone {
  switch (state) {
    case "ok":
      return "success";
    case "warn":
      return "warning";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

export function logTone(level: LogLevel): Tone {
  switch (level) {
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    case "INFO":
      return "info";
    default:
      return "neutral";
  }
}

export function errorTone(category: ErrorCategory | string | null | undefined): Tone {
  switch (category) {
    case "rate_limit":
    case "timeout":
      return "warning";
    case "bad_request":
    case "validation":
      return "neutral";
    case "auth":
    case "config":
      return "error";
    default:
      return "error";
  }
}

export const DIRECTION_LABEL: Record<MessageDirection, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
};

export const STATUS_LABEL: Record<MessageStatus, string> = {
  received: "Received",
  processing: "Processing",
  delivered: "Delivered",
  failed: "Failed",
  skipped: "Skipped",
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};
