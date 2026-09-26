import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/lib/sanitize";

/**
 * Lightweight protection for mutating admin routes.
 *
 * There is no user system here by design. When ADMIN_API_KEY is set, a write
 * must present the matching `x-admin-key` header; when it is not set the route
 * is open, which is the right default for a localhost or private deployment.
 */
export function assertAdminKey(request: Request): NextResponse | null {
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) return null;
  const provided = request.headers.get("x-admin-key");
  if (provided === expected) return null;
  return NextResponse.json(
    { error: "Missing or incorrect admin key." },
    { status: 401 },
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Wraps a handler so validation and unexpected errors become safe responses. */
export function handle(
  name: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  return fn().catch(async (error: unknown) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const message = first
        ? `${first.path.join(".") || "input"}: ${first.message}`
        : "Invalid request";
      return fail(message, 422);
    }
    await logger.error({
      category: "API",
      event: `api.${name}.failed`,
      message: safeErrorMessage(error),
    });
    return fail("The server could not complete that request. See the logs for details.", 500);
  });
}

/** Parses JSON without throwing on a bad body. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
