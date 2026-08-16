import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/styles/**", "src/lib/api.ts", "src/lib/format.ts", "src/lib/theme-dom.ts"],
      thresholds: { statements: 70, functions: 70, lines: 70 },
    },
  },
});
