/**
 * FILE: apps/admin/src/lib/sentrySourcemaps.test.ts
 * PURPOSE: @sentry/vite-plugin 11 uploads with glob 14 (5.3 used glob 13).
 *          Confirm the plugin's upload patterns and our delete glob still
 *          select the same build artifacts.
 */

import { realpathSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { SENTRY_VITE_UPLOAD_GLOBS, sentrySourcemapDeleteGlobs } from './sentrySourcemaps'

const FIXTURE = [
  'index.html',
  'assets/index-abc.js',
  'assets/index-abc.js.map',
  'assets/vendor-sentry-def.js',
  'assets/vendor-sentry-def.js.map',
  'assets/style.css',
  'assets/style.css.map',
  'sw.js',
  'sw.js.map',
  'nested/dir/chunk.js',
  'nested/dir/chunk.js.map',
]

type GlobFn = (
  pattern: string | string[],
  options: { absolute: true; nodir: true; root?: string },
) => Promise<string[]>

async function pluginGlob(): Promise<GlobFn> {
  const pluginJson = realpathSync(path.resolve(__dirname, '../../node_modules/@sentry/vite-plugin/package.json'))
  const pluginRequire = createRequire(pluginJson)
  const bundlerJson = realpathSync(pluginRequire.resolve('@sentry/bundler-plugins/package.json'))
  const bundlerRequire = createRequire(bundlerJson)
  const globEntry = bundlerRequire.resolve('glob')
  const mod = (await import(pathToFileURL(globEntry).href)) as { glob: GlobFn }
  return mod.glob
}

describe('sentry vite sourcemap globs', () => {
  let dist = ''

  afterAll(async () => {
    if (dist) await rm(dist, { recursive: true, force: true })
  })

  it('uploads the same js artifacts and still deletes every map', async () => {
    const pluginJson = realpathSync(path.resolve(__dirname, '../../node_modules/@sentry/vite-plugin/package.json'))
    const plugin = JSON.parse(readFileSync(pluginJson, 'utf8')) as { version: string }
    expect(plugin.version.startsWith('11.')).toBe(true)

    dist = await mkdtemp(path.join(tmpdir(), 'admin-sentry-dist-'))
    for (const file of FIXTURE) {
      const target = path.join(dist, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, 'x')
    }

    const glob = await pluginGlob()
    const rel = (files: string[]) => files.map((file) => path.relative(dist, file)).sort()

    const uploaded = rel(await glob(SENTRY_VITE_UPLOAD_GLOBS, { absolute: true, nodir: true, root: dist }))
    expect(uploaded).toEqual([
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/vendor-sentry-def.js',
      'assets/vendor-sentry-def.js.map',
      'nested/dir/chunk.js',
      'nested/dir/chunk.js.map',
      'sw.js',
      'sw.js.map',
    ])

    const deleted = rel(await glob(sentrySourcemapDeleteGlobs(dist), { absolute: true, nodir: true }))
    expect(deleted).toEqual([
      'assets/index-abc.js.map',
      'assets/style.css.map',
      'assets/vendor-sentry-def.js.map',
      'nested/dir/chunk.js.map',
      'sw.js.map',
    ])
  })
})
