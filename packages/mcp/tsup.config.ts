import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  external: ['@modelcontextprotocol/sdk', 'zod', '@mushi-mushi/core'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
