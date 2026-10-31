/**
 * FILE: packages/mcp/src/__tests__/optional-sentry.test.ts
 * PURPOSE: @sentry/node is an optional peer. Without MUSHI_MCP_SENTRY_DSN the
 *          stdio binary never imports it (so a plain `npx @mushi-mushi/mcp`
 *          does not need it installed); with a DSN it initialises exactly as
 *          the old static import did; with a DSN but no SDK it keeps running.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initOptionalSentry, sentryDataCollection } from '../optional-sentry.js'

describe('initOptionalSentry', () => {
  it('never imports @sentry/node when no DSN is set', async () => {
    const importSentry = vi.fn()
    const warn = vi.fn()
    expect(await initOptionalSentry({}, { importSentry, warn })).toBe('disabled')
    expect(await initOptionalSentry({ MUSHI_MCP_SENTRY_DSN: '   ' }, { importSentry, warn })).toBe('disabled')
    expect(importSentry).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('initialises with the same options as the former static import when a DSN is set', async () => {
    const init = vi.fn()
    const status = await initOptionalSentry(
      { MUSHI_MCP_SENTRY_DSN: ' https://k@o1.ingest.sentry.io/1 ', MUSHI_SENTRY_ENVIRONMENT: 'staging', NODE_ENV: 'production' },
      { importSentry: async () => ({ init }), warn: vi.fn() },
    )
    expect(status).toBe('enabled')
    expect(init).toHaveBeenCalledWith({
      dsn: 'https://k@o1.ingest.sentry.io/1',
      environment: 'staging',
      tracesSampleRate: 0,
      dataCollection: sentryDataCollection,
    })
    expect(sentryDataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
    })
  })

  it('falls back to NODE_ENV, then development, for the environment', async () => {
    const init = vi.fn()
    await initOptionalSentry({ MUSHI_MCP_SENTRY_DSN: 'd', NODE_ENV: 'production' }, { importSentry: async () => ({ init }), warn: vi.fn() })
    await initOptionalSentry({ MUSHI_MCP_SENTRY_DSN: 'd' }, { importSentry: async () => ({ init }), warn: vi.fn() })
    expect(init.mock.calls.map(([o]) => (o as { environment: string }).environment)).toEqual(['production', 'development'])
  })

  it('keeps serving and says how to install the SDK when the DSN is set but @sentry/node is missing', async () => {
    const warn = vi.fn()
    const status = await initOptionalSentry(
      { MUSHI_MCP_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' },
      {
        importSentry: async () => {
          throw new Error("Cannot find package '@sentry/node'")
        },
        warn,
      },
    )
    expect(status).toBe('unavailable')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/npm i @sentry\/node/)
  })
})

/** Object literal of `export const sentryDataCollection`, ignoring a trailing `satisfies` clause. */
function sentryDataCollectionLiteral(source: string): string {
  const marker = 'export const sentryDataCollection = '
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('sentryDataCollection export is missing')
  let i = start + marker.length
  if (source[i] !== '{') throw new Error('sentryDataCollection is not an object literal')
  let depth = 0
  const begin = i
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(begin, i + 1)
    }
  }
  throw new Error('sentryDataCollection object is unterminated')
}

describe('@sentry/node packaging', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }

  it('is an optional peer, not a runtime dependency every install pulls in', () => {
    expect(pkg.dependencies?.['@sentry/node']).toBeUndefined()
    expect(pkg.peerDependencies?.['@sentry/node']).toBeDefined()
    expect(pkg.peerDependenciesMeta?.['@sentry/node']?.optional).toBe(true)
  })

  it('accepts an installed v10 peer and develops against v11', () => {
    expect(pkg.peerDependencies?.['@sentry/node']).toBe('^10.57.0 || ^11.8.0')
    expect(pkg.devDependencies?.['@sentry/node']).toBe('^11.8.0')
    const note = readFileSync(resolve(__dirname, '../../../../.changeset/sentry-sdk-11.md'), 'utf8')
    expect(note).toMatch(/'@mushi-mushi\/mcp': patch/)
    expect(note).toContain('^10.57.0 || ^11.8.0')
  })

  it('keeps the same privacy baseline as the admin console', () => {
    const here = readFileSync(resolve(__dirname, '../optional-sentry.ts'), 'utf8')
    const admin = readFileSync(resolve(__dirname, '../../../../apps/admin/src/lib/sentry.ts'), 'utf8')
    expect(sentryDataCollectionLiteral(here)).toBe(sentryDataCollectionLiteral(admin))
    expect(here).toContain('apps/admin/src/lib/sentry.ts')
    expect(admin).toContain('packages/mcp/src/optional-sentry.ts')
  })

  it('is not imported statically by the stdio entry point', () => {
    const entry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8')
    expect(entry).not.toMatch(/from ['"]@sentry\/node['"]/)
  })
})
