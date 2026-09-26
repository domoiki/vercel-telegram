/**
 * Makes the `server-only` marker resolvable for CLI scripts.
 *
 * Next.js provides `server-only` as a virtual alias, so any plain-Node script
 * that imports a guarded module fails to resolve it. This is registered only
 * for the CLI QA scripts (see stub-server-only.mjs) and never affects the
 * application build, where the real guard still runs.
 *
 * Both loaders are patched: tsx compiles the project's `.ts` files to CJS, so
 * the CommonJS resolver is the one that actually hits `server-only` here.
 */
import { register } from "node:module";
import Module from "node:module";
import { fileURLToPath } from "node:url";

const stub = fileURLToPath(new URL("../src/test/server-only-stub.ts", import.meta.url));

// CommonJS path.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === "server-only") return stub;
  return originalResolve.call(this, request, ...rest);
};

// ESM path.
register("./stub-server-only.mjs", import.meta.url);
