import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Next.js App Router treats a module without 'use client' as a Server
// Component, and every export here uses context, state or effects. tsup emits
// the directive as a banner, but a Rollup tree-shake pass strips it silently,
// so the shipped bundles are checked directly (turbo runs `build` before
// `test`).
// path.resolve rather than `new URL('../dist/…', import.meta.url)`: Vite
// rewrites that literal pattern as an asset URL and resolves it from the root.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const bundles = ['index.js', 'index.cjs'].map((name) => ({ name, path: resolve(distDir, name) }));

describe('published bundles', () => {
  for (const { name, path } of bundles) {
    it(`dist/${name} opens with the 'use client' directive`, () => {
      expect(existsSync(path), `dist/${name} is missing — run \`pnpm --filter @mushi-mushi/react build\` first`).toBe(true);
      const firstStatement = readFileSync(path, 'utf8').trimStart().split('\n', 1)[0];
      expect(firstStatement).toBe("'use client';");
    });
  }
});
