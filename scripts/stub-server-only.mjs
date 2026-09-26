/**
 * Resolver hook that maps the `server-only` marker to an empty module.
 *
 * Next.js provides `server-only` as a virtual alias; it is not on disk, so any
 * plain-Node script that imports a guarded module fails to resolve it. This
 * hook is only registered for the CLI QA scripts (see register-stub.mjs) and
 * never affects the application build, where the real guard still runs.
 */
import { pathToFileURL } from "node:url";

const STUB = pathToFileURL(
  new URL("../src/test/server-only-stub.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
).href;

export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: STUB, format: "module", shortCircuit: true };
  }
  return next(specifier, context);
}
