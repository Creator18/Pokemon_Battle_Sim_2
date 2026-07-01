import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/shared/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
