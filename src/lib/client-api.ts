"use client";

const STORAGE_KEY = "tg_gateway_admin_key";

/**
 * Thin fetch wrapper for the dashboard's own API.
 *
 * If ADMIN_API_KEY is set on the server, writes need the matching header. The
 * key is held in sessionStorage for the tab only — never localStorage, never
 * in a cookie, never in a rendered page.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export function setAdminKey(value: string) {
  if (typeof window === "undefined") return;
  if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
  else window.sessionStorage.removeItem(STORAGE_KEY);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const key = getAdminKey();
  if (key) headers.set("x-admin-key", key);

  const response = await fetch(path, { ...init, headers });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

/** Fires a browser event when a write is rejected, so a form can prompt for the key. */
export const ADMIN_KEY_EVENT = "tg:admin-key-required";

export function notifyAdminKeyRequired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADMIN_KEY_EVENT));
}
