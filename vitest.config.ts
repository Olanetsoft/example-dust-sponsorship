import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 15 * 60 * 1000,
    // The flow is a single ordered scenario against one devnet — no parallelism.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
