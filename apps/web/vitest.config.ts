import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Match the app: Next compiles JSX with the automatic runtime, so components under test
  // must not need a `React` import in scope just to render.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@passport/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
