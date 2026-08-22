import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Gate lane: deterministic, local, free. Tests resolve in milliseconds; this
    // ceiling exists to fail a genuine hang, not to absorb machine load, and is
    // deliberately above the Testing Library budget set in vitest.setup.ts.
    testTimeout: 15_000,
    restoreMocks: true,
  },
});
