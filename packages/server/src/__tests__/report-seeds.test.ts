/**
 * FILE: packages/server/src/__tests__/report-seeds.test.ts
 * PURPOSE: The files a report-scoped digest puts first ("Copy code for this
 *          bug"): order frames → fix files → related code → importers, the
 *          per-source caps, the tree filter, stored frames vs stack text, the
 *          no-index fallback, and the per-source counts the console shows.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  MAX_DEPENDENTS,
  MAX_FIX_FILES,
  MAX_FRAME_FILES,
  MAX_RELATED_FILES,
  reportFramePaths,
  resolveReportSeeds,
  type ReportForSeeds,
  type ReportSeedSources,
} from '../../supabase/functions/_shared/report-seeds.ts'

const TREE = [
  'apps/web/src/checkout/Pay.tsx',
  'apps/web/src/lib/cart.ts',
  'apps/web/src/lib/price.ts',
  'apps/web/src/pages/Checkout.tsx',
  'apps/web/src/App.tsx',
  'README.md',
]

function report(overrides: Partial<ReportForSeeds> = {}): ReportForSeeds {
  return { id: 'r1', summary: 'Pay button does nothing', component: 'Pay', custom_metadata: {}, console_logs: [], ...overrides }
}

function sources(overrides: Partial<ReportSeedSources> = {}): ReportSeedSources {
  return {
    fixFiles: async () => [],
    relatedCode: async () => [],
    importers: async () => [],
    ...overrides,
  }
}

describe('reportFramePaths', () => {
  it('prefers stored Sentry frames', () => {
    expect(
      reportFramePaths({
        custom_metadata: { sentryFrames: ['src/checkout/Pay.tsx', 42] },
        console_logs: [{ stack: '  at x (webpack:///./src/lib/cart.ts:3:1)' }],
      }),
    ).toEqual(['src/checkout/Pay.tsx'])
  })
  it('falls back to the stored stack text', () => {
    expect(
      reportFramePaths({
        custom_metadata: null,
        console_logs: [{ stack: 'Error: boom\n  at add (webpack:///./src/lib/cart.ts:3:1)' }, null],
      }),
    ).toEqual(['src/lib/cart.ts'])
  })
})

describe('resolveReportSeeds', () => {
  it('orders frames, then fix files, then related code, then importers, and counts each', async () => {
    const importers = vi.fn(async () => ['apps/web/src/pages/Checkout.tsx', 'apps/web/src/checkout/Pay.tsx'])
    const out = await resolveReportSeeds(
      report({ custom_metadata: { sentryFrames: ['src/checkout/Pay.tsx'] } }),
      TREE,
      sources({
        fixFiles: async () => [['apps/web/src/lib/cart.ts']],
        relatedCode: async () => ['apps/web/src/lib/price.ts', 'apps/web/src/checkout/Pay.tsx'],
        importers,
      }),
    )
    expect(out.seeds).toEqual([
      'apps/web/src/checkout/Pay.tsx',
      'apps/web/src/lib/cart.ts',
      'apps/web/src/lib/price.ts',
      'apps/web/src/pages/Checkout.tsx',
    ])
    expect(out.sources).toEqual({ stack_frames: 1, fix_files: 1, related_code: 1, dependents: 1 })
    // Importers are looked up from the direct seeds only.
    expect(importers).toHaveBeenCalledWith(['apps/web/src/checkout/Pay.tsx', 'apps/web/src/lib/cart.ts', 'apps/web/src/lib/price.ts'])
  })

  it('drops paths that are not in the tree at the pinned commit', async () => {
    const out = await resolveReportSeeds(
      report(),
      TREE,
      sources({
        fixFiles: async () => [['apps/web/src/deleted.ts', './apps/web/src/lib/cart.ts']],
        relatedCode: async () => ['other-branch/only.ts'],
        importers: async () => ['gone/Importer.tsx'],
      }),
    )
    expect(out.seeds).toEqual(['apps/web/src/lib/cart.ts'])
    expect(out.sources).toEqual({ stack_frames: 0, fix_files: 1, related_code: 0, dependents: 0 })
  })

  it('caps each source: frames 20, fix files 20 across attempts, related 5, importers 20', async () => {
    const big = Array.from({ length: 60 }, (_, i) => `src/f${i}.ts`)
    const tree = [...big, ...Array.from({ length: 40 }, (_, i) => `src/dep${i}.ts`)]
    const out = await resolveReportSeeds(
      report({ custom_metadata: { sentryFrames: big.slice(0, 30) } }),
      tree,
      sources({
        fixFiles: async () => [big.slice(30, 45), big.slice(45, 60)],
        relatedCode: async () => tree.slice(80, 100),
        importers: async () => Array.from({ length: 40 }, (_, i) => `src/dep${i}.ts`),
      }),
    )
    expect(out.sources.stack_frames).toBe(MAX_FRAME_FILES)
    expect(out.sources.fix_files).toBe(MAX_FIX_FILES)
    expect(out.sources.related_code).toBe(MAX_RELATED_FILES)
    // 40 importers, 5 of them already related code: 35 candidates, capped at 20.
    expect(out.sources.dependents).toBe(MAX_DEPENDENTS)
    expect(out.seeds).toHaveLength(MAX_FRAME_FILES + MAX_FIX_FILES + MAX_RELATED_FILES + MAX_DEPENDENTS)
    expect(new Set(out.seeds).size).toBe(out.seeds.length)
  })

  it('still returns frames and fix files when there is no index (RAG and graph fail or are empty)', async () => {
    const warn = vi.fn()
    const out = await resolveReportSeeds(
      report({ console_logs: [{ stack: '  at add (webpack:///./src/lib/cart.ts:3:1)' }] }),
      TREE,
      sources({
        fixFiles: async () => [['apps/web/src/App.tsx']],
        relatedCode: async () => {
          throw new Error('index disabled')
        },
        importers: async () => {
          throw new Error('no graph')
        },
        warn,
      }),
    )
    expect(out.seeds).toEqual(['apps/web/src/lib/cart.ts', 'apps/web/src/App.tsx'])
    expect(out.sources).toEqual({ stack_frames: 1, fix_files: 1, related_code: 0, dependents: 0 })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('reports zero linked files plainly, without calling the graph', async () => {
    const importers = vi.fn(async () => [])
    const out = await resolveReportSeeds(report({ summary: null }), TREE, sources({ importers }))
    expect(out).toEqual({ seeds: [], sources: { stack_frames: 0, fix_files: 0, related_code: 0, dependents: 0 } })
    expect(importers).not.toHaveBeenCalled()
  })
})
