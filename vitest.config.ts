import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // The synthetic pairs and their ground truth are generated, never committed.
    globalSetup: ["src/testing/samples-setup.ts"],
  },
});
