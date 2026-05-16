import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'packages/testing/unit',
    include: ['**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@lash/editor-core': path.resolve(__dirname, 'packages/editor-core/src'),
      '@lash/authorship': path.resolve(__dirname, 'packages/authorship/src'),
      '@lash/doc-chat': path.resolve(__dirname, 'packages/doc-chat/src'),
      '@lash/history': path.resolve(__dirname, 'packages/history/src'),
      '@lash/ui': path.resolve(__dirname, 'packages/ui/src'),
      '@lash/types': path.resolve(__dirname, 'packages/types/src'),
      '@lash/testing': path.resolve(__dirname, 'packages/testing'),
    },
  },
});
