/**
 * FILE: packages/react-native/src/__tests__/optional-modules.test.ts
 * PURPOSE: Optional native peers (netinfo, view-shot, expo-sensors) never
 * crash the host app:
 * - a module the host injects is used as is, with no dynamic loading;
 * - a missing module resolves to null;
 * - the built dist carries literal `require("<module>")` calls and no
 *   esbuild `__require(` shim (Metro can't resolve the shim — the 0.21–0.23
 *   crash). The build itself fails on a leftover shim; this re-checks dist.
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveExpoSensors, resolveNetInfo, resolveViewShot } from '../optional-modules'
import { OPTIONAL_NATIVE_MODULES, preserveOptionalRequires } from '../bundling/preserve-optional-requires'

describe('injected optional modules', () => {
  it('uses an injected default export as is', () => {
    const netInfo = { addEventListener: vi.fn(() => () => {}) }
    expect(resolveNetInfo(netInfo)).toBe(netInfo)
    const viewShot = { captureScreen: vi.fn(async () => 'data:image/jpeg;base64,x') }
    expect(resolveViewShot(viewShot)).toBe(viewShot)
    const sensors = { Accelerometer: { setUpdateInterval: vi.fn(), addListener: vi.fn(() => ({ remove: vi.fn() })) } }
    expect(resolveExpoSensors(sensors)).toBe(sensors)
  })

  it('accepts a module namespace (`import * as NetInfo`) and unwraps its default', () => {
    const netInfo = { addEventListener: vi.fn(() => () => {}) }
    expect(resolveNetInfo({ default: netInfo })).toBe(netInfo)
  })

  it('rejects an injected value that is not the module, instead of throwing later', () => {
    expect(resolveNetInfo({ nope: true })).toBeNull()
    expect(resolveViewShot(42)).toBeNull()
  })

  it('resolves null when the package is not installed (never throws)', () => {
    expect(resolveNetInfo()).toBeNull()
    expect(resolveViewShot()).toBeNull()
    expect(resolveExpoSensors()).toBeNull()
  })
})

describe('preserveOptionalRequires (build step)', () => {
  const shim = 'var __require = /* @__PURE__ */ ((x) => x)(function(x) {\n  throw Error("no");\n});\n'

  it('restores literal requires for the optional peers and drops the dead shim', () => {
    const out = preserveOptionalRequires(
      `${shim}const a = __require("@react-native-community/netinfo");\nconst b = __require('react-native-view-shot');\n`,
    )
    expect(out.rewritten).toBe(2)
    expect(out.leftovers).toEqual([])
    expect(out.code).toContain('require("@react-native-community/netinfo")')
    expect(out.code).toContain("require('react-native-view-shot')")
    expect(out.code).not.toContain('__require')
  })

  it('reports any other shim call as a leftover (the build fails on it)', () => {
    const out = preserveOptionalRequires(`${shim}const c = __require("some-new-native-dep");\n`)
    expect(out.leftovers).toEqual(['__require("some-new-native-dep")'])
    expect(out.code).toContain('var __require')
  })
})

// This package's tsconfig carries no Node types; the test runner is Node.
const fs = (await import('node:fs' as string)) as {
  existsSync(path: URL): boolean
  readFileSync(path: URL, encoding: 'utf8'): string
}

describe('built dist', () => {
  for (const file of ['index.js', 'index.cjs']) {
    const path = new URL(`../../dist/${file}`, import.meta.url)
    // The build fails on a leftover shim; this re-checks whatever dist is on disk.
    it.skipIf(!fs.existsSync(path))(`${file} has no __require( shim and literal requires for every optional peer`, () => {
      const code = fs.readFileSync(path, 'utf8')
      expect(code.match(/__require\(/g) ?? []).toHaveLength(0)
      for (const name of OPTIONAL_NATIVE_MODULES) expect(code).toContain(`require("${name}")`)
    })
  }
})
