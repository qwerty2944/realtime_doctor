import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit test runner for the pure logic modules (red flag matching, negation).
 *
 * Scoped to `src/lib/**` on purpose: these are the modules with rules worth pinning,
 * and none of them touch the network or the database. Anything that needs Supabase or
 * the Anthropic API is exercised against the real services instead of a mock, so
 * there is no jsdom / React testing setup here to keep in sync.
 *
 * The `@/` alias mirrors tsconfig.json `paths` so tests and application code import
 * the same way.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
