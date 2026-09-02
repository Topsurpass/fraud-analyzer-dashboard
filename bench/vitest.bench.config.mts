import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The bench lane. Deliberately a second config rather than a second `include`
 * in the gate config: these files take seconds each and must never run on a
 * commit, and the gate lane's `include` (`src/**` only) is what keeps them out.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["bench/**/*.bench.tsx"],
    setupFiles: ["./bench/setup.ts"],
    // One measurement file, run in one process, so the numbers in the table
    // come from the same JIT state rather than from racing workers.
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 600_000,
  },
});
