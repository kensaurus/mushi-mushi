import { describe, expect, it } from 'vitest'
import {
  isStaleCheck,
  sortStorageCards,
  sortUsageRows,
  storageFieldsFor,
  storageProblems,
  type StorageRowLike,
} from './storageView'

const row = (id: string, over: Partial<StorageRowLike> = {}): StorageRowLike => ({
  project_id: id,
  provider: 's3',
  health_status: 'healthy',
  last_health_check_at: null,
  last_health_error: null,
  ...over,
})
const names: Record<string, string> = { a: 'alpha', b: 'beta', g: 'glot.it', y: 'yen-yen' }

describe('storageProblems', () => {
  it('lists failing buckets first with their error, then degraded, and skips healthy or unchecked ones', () => {
    const out = storageProblems(
      [
        row('y', { health_status: 'degraded' }),
        row('a', { health_status: 'healthy' }),
        row('g', { health_status: 'failing', last_health_error: 'Missing vault secret' }),
        row('b', { health_status: 'unknown' }),
      ],
      (id) => names[id],
    )
    expect(out.map((p) => [p.name, p.status, p.error])).toEqual([
      ['glot.it', 'failing', 'Missing vault secret'],
      ['yen-yen', 'degraded', null],
    ])
  })
})

describe('sortStorageCards', () => {
  it('puts failing first and apps on the built-in storage last', () => {
    const cards = [
      { id: 'a', existing: false, setting: { health_status: 'unknown' as const } },
      { id: 'b', existing: true, setting: { health_status: 'healthy' as const } },
      { id: 'g', existing: true, setting: { health_status: 'failing' as const } },
      { id: 'y', existing: true, setting: { health_status: 'unknown' as const } },
    ]
    expect(sortStorageCards(cards, (c) => names[c.id]).map((c) => c.id)).toEqual(['g', 'y', 'b', 'a'])
  })
})

describe('storageFieldsFor', () => {
  it('hides every S3 field on Supabase Storage', () => {
    expect(storageFieldsFor({ provider: 'supabase' })).toEqual({
      region: false,
      endpoint: false,
      accessKeys: false,
      serviceAccount: false,
      kms: false,
    })
  })
  it('shows the fields each provider uses', () => {
    expect(storageFieldsFor({ provider: 's3' })).toMatchObject({ region: true, endpoint: true, accessKeys: true, kms: true })
    expect(storageFieldsFor({ provider: 'gcs' })).toMatchObject({ accessKeys: false, serviceAccount: true, region: false })
    expect(storageFieldsFor({ provider: 'r2' })).toMatchObject({ accessKeys: true, kms: false })
  })
  it('never hides a field that already holds a saved value', () => {
    expect(storageFieldsFor({ provider: 'supabase', kms_key_id: 'k', access_key_vault_ref: 'ref' })).toMatchObject({ kms: true, accessKeys: true })
  })
})

describe('usage and staleness', () => {
  it('sorts usage by screenshots, zeros last', () => {
    expect(sortUsageRows([
      { name: 'b', objects: 0 },
      { name: 'a', objects: 7 },
      { name: 'c', objects: 44 },
      { name: 'a0', objects: 0 },
    ]).map((r) => r.name)).toEqual(['c', 'a', 'a0', 'b'])
  })
  it('flags a check older than a week', () => {
    const now = Date.parse('2026-11-18T00:00:00Z')
    expect(isStaleCheck('2026-05-19T00:00:00Z', now)).toBe(true)
    expect(isStaleCheck('2026-11-17T00:00:00Z', now)).toBe(false)
    expect(isStaleCheck(null, now)).toBe(false)
  })
})
