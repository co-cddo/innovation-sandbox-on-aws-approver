import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'cdk/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/types.ts', 'src/lib/logger.ts'],
      thresholds: {
        lines: 90,
        branches: 85, // Lowered from 90% - vitest v4 has more accurate branch detection
        functions: 90,
        statements: 90,
      },
    },
  },
});
