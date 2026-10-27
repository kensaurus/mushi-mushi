/**
 * FILE: packages/vscode-extension/module-resolution.test.mjs
 * PURPOSE: Lock the VS Code extension on TypeScript node16 resolution and
 *          CommonJS emit for the extension host.
 *
 * USAGE: node --test module-resolution.test.mjs
 *
 * The extension host loads dist/extension.js through require. package.json has
 * no "type": "module", so module node16 still emits CommonJS. The check lowers
 * ignoreDeprecations to 5.0 so a leftover moduleResolution node10 (deprecated
 * in TypeScript 6, removed in TypeScript 7) fails here instead of being hidden
 * by tooling/tsconfig/base.json.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const tsc = require.resolve('typescript/lib/tsc.js')

test('extension tsconfig uses node16 and the package stays CommonJS', () => {
  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(tsconfig.compilerOptions.module, 'node16')
  assert.equal(tsconfig.compilerOptions.moduleResolution, 'node16')
  assert.equal(pkg.type, undefined)
  assert.equal(pkg.main, './dist/extension.js')
})

test('node16 emit is CommonJS without the TypeScript 6 deprecation suppression', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'mushi-vscode-emit-'))
  const overlay = join(root, 'tsconfig.module-resolution-check.json')
  writeFileSync(
    overlay,
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          ignoreDeprecations: '5.0',
          outDir,
        },
      },
      null,
      2,
    )}\n`,
  )
  try {
    const result = spawnSync(process.execPath, [tsc, '-p', overlay, '--pretty', 'false'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const js = readFileSync(join(outDir, 'extension.js'), 'utf8')
    assert.match(js, /require\("vscode"\)/)
    assert.match(js, /exports\.activate = activate/)
    assert.doesNotMatch(js, /^(?:import|export)\s/m)
  } finally {
    rmSync(overlay, { force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
})
