import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the server integration tests.
 *
 * The root `vitest.config.ts` restricts `include` to `src/shared/__tests__`
 * (and is owned by others / must not be modified), so `npx vitest run server`
 * finds nothing. Run the server suite with this config instead:
 *
 *   npx vitest run --config server/vitest.config.ts
 */
export default defineConfig({
  test: {
    include: ['server/__tests__/**/*.test.ts'],
    environment: 'node',
    root: '.',
  },
});
