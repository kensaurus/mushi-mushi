import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  exports: Record<string, { import: string }>
}
// Read as text: tsup.config.ts sits outside this package's rootDir.
const tsupEntries = new Set(
  [...readFileSync(resolve(root, 'tsup.config.ts'), 'utf8').matchAll(/'src\/([a-z0-9-]+)\.ts'/g)].map((m) => m[1]),
)

describe('every exported subpath is built', () => {
  it('has a tsup entry for each package.json export', () => {
    const exported = Object.values(pkg.exports).map((target) => target.import.replace(/^\.\/dist\//, '').replace(/\.js$/, ''))
    expect(exported.length).toBeGreaterThan(1)
    expect(exported.filter((name) => !tsupEntries.has(name))).toEqual([])
  })
})
