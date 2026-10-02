/**
 * Plan 020 Phase 2 store ops, read side: runStoreReview compares the listing
 * in the repo with what is live, checks claims against code evidence, reads
 * screenshot sizes, builds the pre-submission checklist, and records one
 * store_review run. Anything it could not read is `unknown`, never ok.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let ops: typeof import('../../supabase/functions/_shared/store-ops.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  ops = await import('../../supabase/functions/_shared/store-ops.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T12:00:00Z')
const repo = { ref: { owner: 'k', repo: 'hhtp' }, token: 't', repoUrl: '', defaultBranchHint: 'main' }

/** A 1080x2400 PNG header (Android-shaped, not an iPhone size). */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0)
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

function deps(over: Partial<import('../../supabase/functions/_shared/store-ops.ts').StoreOpsDeps> = {}) {
  const files: Record<string, string> = {
    'fastlane/metadata/en-US/name.txt': 'Help Her Take Photo\n',
    'fastlane/metadata/en-US/description.txt': 'Photos never leave your phone. Open source.\n',
    'package.json': JSON.stringify({ dependencies: { '@sentry/react-native': '6', 'posthog-react-native': '3' } }),
  }
  return {
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'abc1234' })),
    listTree: vi.fn(async () => ({ truncated: false, entries: [...Object.keys(files), 'fastlane/screenshots/en-US/iphone-1.png'].map((path) => ({ path, size: 10 })) })),
    readBlobs: vi.fn(async (_r: unknown, _s: string, paths: readonly string[]) => new Map(paths.map((p) => [p, files[p] ?? null]))),
    readBytes: vi.fn(async () => ({ kind: 'file' as const, bytes: pngHeader(1080, 2400) })),
    lastChanged: vi.fn(async () => '2026-01-01T00:00:00Z'),
    repoInfo: vi.fn(async () => ({ public: false, license: null })),
    fetcher: vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) return { status: 200, headers: new Headers(), finalUrl: url, text: JSON.stringify({ resultCount: 1, results: [{ trackName: 'Help Her Take Photo', sellerName: 'K', description: 'Photos never leave your phone. Open source. Updated text.' }] }) }
      throw new Error('offline')
    }),
    extractClaims: vi.fn(async () => [
      { claim: 'Photos stay on the device', kind: 'on_device' as const, quote: 'Photos never leave your phone.' },
      { claim: 'The app is open source', kind: 'open_source' as const, quote: 'Open source.' },
    ]),
    uploadPaths: vi.fn(async () => ['src/lib/upload.ts']),
    now: () => NOW,
    ...over,
  }
}

describe('runStoreReview', () => {
  it('finds listing drift, contradicted claims and Android-shaped iOS screenshots, and records one run', async () => {
    const db = makeFakeDb({
      app_recipe_snapshots: [{ project_id: P1, is_current: true, manifest: { version: 1, app: { ids: { bundleId: 'com.hhtp.app' } }, store: { listingDir: 'fastlane/metadata', locales: ['en-US'] } } }],
      releases: [{ project_id: P1, published_at: '2026-09-01T00:00:00Z' }, { project_id: P1, published_at: '2026-08-01T00:00:00Z' }, { project_id: P1, published_at: '2026-07-01T00:00:00Z' }, { project_id: P1, published_at: '2026-06-01T00:00:00Z' }],
    } as never, { autoId: true })
    const report = await ops.runStoreReview(db as never, P1, deps() as never)
    const state = (id: string) => report.results.find((r) => r.ruleId === id)?.state
    expect(state('listing_drift')).toBe('finding')
    expect(state('listing_claim_contradicts_code')).toBe('finding')
    expect(state('screenshot_platform_mismatch')).toBe('finding')
    expect(state('privacy_label_mismatch')).toBe('unknown')
    const claims = report.results.find((r) => r.ruleId === 'listing_claim_contradicts_code')!.findings.map((f) => f.message).join(' ')
    expect(claims).toMatch(/uploads user content at src\/lib\/upload\.ts/)
    expect(claims).toMatch(/private/)
    expect(report.checklist.items.find((i) => i.id === 'review_risk_default_persona')?.risk).toBe('unknown')
    expect(db.table('gate_runs')).toHaveLength(1)
    expect(db.table('gate_runs')[0]).toMatchObject({ gate: 'store_review', status: 'fail' })
  })

  it('says unknown, not ok, when there is no listing in the repo and no AI key', async () => {
    const db = makeFakeDb({ app_recipe_snapshots: [{ project_id: P1, is_current: true, manifest: { version: 1 } }] } as never, { autoId: true })
    const report = await ops.runStoreReview(db as never, P1, deps({ extractClaims: null, fetcher: vi.fn(async () => { throw new Error('offline') }) }) as never)
    for (const r of report.results) expect(r.state, r.ruleId).not.toBe('ok')
    expect(report.results.find((r) => r.ruleId === 'listing_drift')?.reason).toMatch(/listingDir/)
  })

  it('names the data-collecting SDKs in package.json', () => {
    expect(ops.dataCollectorsFromPackageJson(JSON.stringify({ dependencies: { '@sentry/nextjs': '1', 'posthog-js': '1', react: '19' } }))).toEqual(['PostHog', 'Sentry'])
    expect(ops.dataCollectorsFromPackageJson('nope')).toBeNull()
  })
})
