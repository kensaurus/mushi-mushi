/**
 * @vitest-environment node
 *
 * A minifying bundle (Vite's dependency pre-bundle) folded the old
 * `const specifier = 'rrweb'; await import(specifier)` into a literal
 * `import("rrweb")`, which Vite then failed to resolve in any host without
 * rrweb installed: the-wanting-mind's dev server 500'd on SDK 1.31.0.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type EsbuildApi = {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>
}

// esbuild is tsup's dependency, not this package's, so resolve it through tsup.
const require = createRequire(import.meta.url)
const esbuild = require(createRequire(require.resolve('tsup')).resolve('esbuild')) as EsbuildApi

describe('replay rrweb specifier', () => {
  it('survives a minifying bundle as a dynamic import', async () => {
    const result = await esbuild.build({
      entryPoints: [fileURLToPath(new URL('./replay.ts', import.meta.url))],
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      external: ['@mushi-mushi/core'],
      logLevel: 'silent',
    })
    const out = result.outputFiles[0].text
    expect(out).not.toMatch(/await\s*import\(\s*(\/\*[^*]*\*\/\s*)?["']rrweb["']\s*\)/)
  })
})
