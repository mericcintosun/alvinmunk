import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Match the app: Next compiles JSX with the automatic runtime, so components under test
  // must not need a `React` import in scope just to render. Vite 8 transforms with Oxc (the
  // `esbuild` option is ignored), and Oxc would otherwise honour tsconfig's `jsx: "preserve"`.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@passport/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
