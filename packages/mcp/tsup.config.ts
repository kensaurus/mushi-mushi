import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Binary entry — the stdio MCP server that npx/node runs directly.
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    // Both builds write to dist/ and tsup runs them in parallel, so neither
    // cleans: a clean inside one can race the other's .d.ts output. The
    // `build` script empties dist/ once, before tsup starts.
    clean: false,
    target: 'node18',
    // @sentry/node is an optional peer, imported only when MUSHI_MCP_SENTRY_DSN is
    // set (src/optional-sentry.ts) — it must stay a runtime import, never bundled.
    external: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod', '@mushi-mushi/core', '@sentry/node'],
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
    external: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod', '@mushi-mushi/core', '@sentry/node'],
  },
]);
