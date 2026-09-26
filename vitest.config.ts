import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `server-only` throws by design outside a React Server Component graph.
    // None of the modules under test import it, but the alias keeps the
    // resolution identical to the app if that ever changes.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real package throws unless a React Server Component graph is
      // detected. Unit tests run in plain Node, so point it at a no-op.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
