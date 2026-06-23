import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Binary entry — the stdio MCP server that npx/node runs directly.
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'node18',
    external: ['@modelcontextprotocol/sdk', 'zod', '@mushi-mushi/core'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    // Library entry — the catalog and server factory for consumers (admin UI,
    // smoke tests, parity guards). Exported as a separate chunk so importers
    // don't have to pull in the stdio entry-point side effects.
    entry: {
      catalog: 'src/catalog.ts',
      server: 'src/server.ts',
      branding: 'src/branding.ts',
      'feature-groups': 'src/feature-groups.ts',
      clients: 'src/clients.ts',
    },
    format: ['esm'],
    dts: true,
    clean: false,
    target: 'node18',
    external: ['@modelcontextprotocol/sdk', 'zod', '@mushi-mushi/core'],
  },
]);
