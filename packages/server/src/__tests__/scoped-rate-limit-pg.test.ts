/**
 * The container probe must stay opt-in, and its image must be the pinned
 * Postgres reference. These assertions fail if the suite is a default
 * *.test.ts again, or if image selection returns the first cached name
 * that contains "postgres".
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PG_INTEGRATION_GLOB,
  POSTGRES_IMAGE,
  pgIntegrationEnabled,
  pgIntegrationExclude,
  resolvePostgresImage,
} from './scoped-rate-limit-pg.ts'

const HOSTILE_CACHE = [
  'quay.io/prometheuscommunity/postgres-exporter:v0.15.0',
  'postgres:12',
  'bitnami/postgresql:16',
  'postgres:<none>',
]

describe('scoped rate-limit postgres integration gate', () => {
  it('keeps the container suite out of the ordinary run unless the flag is exactly 1', () => {
    expect(pgIntegrationEnabled({})).toBe(false)
    expect(pgIntegrationExclude({})).toEqual([PG_INTEGRATION_GLOB])
    expect(pgIntegrationEnabled({ MUSHI_SERVER_PG_INTEGRATION: 'true' })).toBe(false)
    expect(pgIntegrationEnabled({ MUSHI_SERVER_PG_INTEGRATION: '0' })).toBe(false)
    expect(pgIntegrationExclude({ MUSHI_SERVER_PG_INTEGRATION: '' })).toEqual([PG_INTEGRATION_GLOB])
    expect(pgIntegrationEnabled({ MUSHI_SERVER_PG_INTEGRATION: '1' })).toBe(true)
    expect(pgIntegrationExclude({ MUSHI_SERVER_PG_INTEGRATION: '1' })).toEqual([])
    expect(PG_INTEGRATION_GLOB.endsWith('*.integration.test.ts')).toBe(true)
  })

  it('pins postgres:17-alpine instead of the first cached name containing postgres', () => {
    const picked = resolvePostgresImage(HOSTILE_CACHE)
    const substring = HOSTILE_CACHE.find((line) => line.includes('postgres') && !line.endsWith(':<none>'))
    expect(substring).toBe('quay.io/prometheuscommunity/postgres-exporter:v0.15.0')
    expect(picked).toEqual({ image: POSTGRES_IMAGE, local: false })
    expect(POSTGRES_IMAGE).toBe('postgres:17-alpine')
    expect(picked.image).not.toBe(substring)
    expect(picked.image).not.toContain('exporter')
  })

  it('treats a cached image as local only when the name is exactly the pin', () => {
    expect(resolvePostgresImage(['postgres:17-alpine'])).toEqual({
      image: 'postgres:17-alpine',
      local: true,
    })
    expect(resolvePostgresImage(['  postgres:17-alpine  ']).local).toBe(true)
    expect(resolvePostgresImage(['postgres:17-alpine-extra']).local).toBe(false)
    expect(resolvePostgresImage(['docker.io/library/postgres:17-alpine']).local).toBe(false)
    expect(resolvePostgresImage(['postgres:17']).local).toBe(false)
    expect(resolvePostgresImage(['postgres-exporter:latest']).image).toBe('postgres:17-alpine')
  })

  it('wires the opt-in command and leaves the PGlite regression in the ordinary suite', () => {
    const root = resolve(__dirname, '../..')
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')
    const pkg = readFileSync(resolve(root, 'package.json'), 'utf8')
    const suitePath = resolve(__dirname, 'scoped-rate-limit-claim-concurrent.integration.test.ts')
    const suite = readFileSync(suitePath, 'utf8')
    const pglite = readFileSync(resolve(__dirname, 'scoped-rate-limit-claim-full-window.test.ts'), 'utf8')

    expect(existsSync(resolve(__dirname, 'scoped-rate-limit-claim-concurrent.test.ts'))).toBe(false)
    expect(config).toContain('pgIntegrationExclude')
    expect(pkg).toContain('MUSHI_SERVER_PG_INTEGRATION=1')
    expect(pkg).toContain('scoped-rate-limit-claim-concurrent.integration.test.ts')
    expect(suite).toContain('describe.skipIf(!integration)')
    expect(suite).toContain('resolvePostgresImage')
    expect(suite).not.toMatch(/\.includes\(\s*['"]postgres['"]\s*\)/)
    expect(pglite).not.toContain('MUSHI_SERVER_PG_INTEGRATION')
    expect(pglite).not.toContain('describe.skipIf')
    expect(pglite).toContain('PGlite')
  })
})
