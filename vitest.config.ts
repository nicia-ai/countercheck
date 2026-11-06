import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/smoke.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "smoke",
          include: ["tests/smoke.test.ts"],
        },
      },
    ],
  },
});
