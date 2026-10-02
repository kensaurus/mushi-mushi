/**
 * FILE: sentry-frames-sweep-priority.test.ts
 * PURPOSE: Pin how Sentry stack frames become repo paths, and which files a
 *          capped codebase sweep embeds first.
 */

import { describe, it, expect } from 'vitest'

const frames = await import('../../supabase/functions/_shared/sentry-frames.ts')
const priority = await import('../../supabase/functions/_shared/sweep-file-priority.ts')

describe('normalizeFramePath', () => {
  it('strips runtime and bundler prefixes', () => {
    expect(frames.normalizeFramePath('app:///stores/mistake-patterns.ts')).toBe('stores/mistake-patterns.ts')
    expect(frames.normalizeFramePath('webpack:///./src/lib/live-update.ts')).toBe('src/lib/live-update.ts')
    expect(frames.normalizeFramePath('webpack-internal:///(app-pages-browser)/./src/x.tsx')).toBe('src/x.tsx')
    expect(frames.normalizeFramePath('~/src/services/logging.ts')).toBe('src/services/logging.ts')
    expect(frames.normalizeFramePath('https://glot.it/lib/logger.ts?v=3')).toBe('lib/logger.ts')
    expect(frames.normalizeFramePath('C:\\repo\\src\\a.ts')).toBe('C:/repo/src/a.ts')
  })

  it('drops vendored, bundled and non-source frames', () => {
    expect(frames.normalizeFramePath('app:///_next/static/chunks/main-abc.js')).toBeNull()
    expect(frames.normalizeFramePath('/app/node_modules/react-dom/cjs/x.js')).toBeNull()
    expect(frames.normalizeFramePath('app:///index.android.bundle')).toBeNull()
    expect(frames.normalizeFramePath('vendor.min.js')).toBeNull()
    expect(frames.normalizeFramePath('<anonymous>')).toBeNull()
    expect(frames.normalizeFramePath('../../etc/passwd.ts')).toBeNull()
    expect(frames.normalizeFramePath(null)).toBeNull()
  })
})

describe('extractFramePaths', () => {
  it('returns in-app frames innermost first, skips in_app:false, dedupes', () => {
    const paths = frames.extractFramePaths([
      {
        stacktrace: {
          frames: [
            { filename: 'node_modules/x/index.js', in_app: false },
            { filename: 'app:///src/outer.ts', in_app: true },
            { filename: 'app:///src/unknown.ts' },
            { filename: 'app:///src/inner.ts', in_app: true },
            { filename: 'app:///src/inner.ts', in_app: true },
          ],
        },
      },
    ])
    expect(paths).toEqual(['src/inner.ts', 'src/outer.ts', 'src/unknown.ts'])
  })

  it('falls back to abs_path and bounds the result', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ abs_path: `app:///src/f${i}.ts`, in_app: true }))
    expect(frames.extractFramePaths([{ stacktrace: { frames: many } }], 5)).toHaveLength(5)
    expect(frames.extractFramePaths(undefined)).toEqual([])
  })
})

describe('matchFramePathsToTree', () => {
  const tree = ['apps/web/lib/logger.ts', 'lib/mylogger.ts', 'stores/mistake-patterns.ts', 'a/util.ts', 'b/util.ts']

  it('matches on whole path segments', () => {
    expect(frames.matchFramePathsToTree(['lib/logger.ts'], tree)).toEqual(['apps/web/lib/logger.ts'])
    expect(frames.matchFramePathsToTree(['stores/mistake-patterns.ts'], tree)).toEqual(['stores/mistake-patterns.ts'])
  })

  it('takes a bare filename only when it is unique', () => {
    expect(frames.matchFramePathsToTree(['util.ts'], tree)).toEqual([])
    expect(frames.matchFramePathsToTree(['mistake-patterns.ts'], tree)).toEqual(['stores/mistake-patterns.ts'])
  })
})

describe('framePathsFromStackText', () => {
  it('parses the stack text stored in console_logs', () => {
    const text = [
      'TypeError: x is not a function',
      '  at handleSubmit (app:///src/PaymentForm.tsx:42)',
      '  at go (webpack-internal:///(app-pages-browser)/./src/lib/go.ts:7:3)',
      '  at <anonymous> (?)',
    ].join('\n')
    expect(frames.framePathsFromStackText(text)).toEqual(['src/PaymentForm.tsx', 'src/lib/go.ts'])
  })
})

describe('sweepTier', () => {
  it('ranks app source above other code above tests/docs/config', () => {
    expect(priority.sweepTier('stores/mistake-patterns.ts')).toBe(1)
    expect(priority.sweepTier('src/lib/live-update.ts')).toBe(1)
    expect(priority.sweepTier('middleware.ts')).toBe(2)
    expect(priority.sweepTier('src/__tests__/a.test.ts')).toBe(3)
    expect(priority.sweepTier('components/Button.stories.tsx')).toBe(3)
    expect(priority.sweepTier('next.config.js')).toBe(3)
    expect(priority.sweepTier('.github/scripts/x.ts')).toBe(3)
    expect(priority.sweepTier('docs/guide.md.ts')).toBe(3)
  })
})

describe('prioritizeSweepFiles', () => {
  // Alphabetical order would spend a 4-file cap on .github/ and apps/docs/.
  const tree = [
    '.github/scripts/release.ts',
    'apps/docs/a.test.ts',
    'apps/docs/b.test.ts',
    'e2e/login.spec.ts',
    'lib/logger.ts',
    'middleware.ts',
    'stores/mistake-patterns.ts',
    'stores/user.ts',
    'zz/tool.ts',
  ]

  it('puts stack-frame files first, then source, before tests and config', () => {
    const out = priority.prioritizeSweepFiles(tree, { framePaths: ['stores/mistake-patterns.ts'], cap: 4 })
    expect(out[0]).toBe('stores/mistake-patterns.ts')
    expect(out).toContain('lib/logger.ts')
    expect(out).toContain('stores/user.ts')
    expect(out).not.toContain('.github/scripts/release.ts')
    expect(out).not.toContain('apps/docs/a.test.ts')
    expect(out).toHaveLength(4)
  })

  it('prefers files not yet indexed, so coverage widens across sweeps', () => {
    const out = priority.prioritizeSweepFiles(tree, {
      indexedPaths: new Set(['lib/logger.ts', 'stores/user.ts']),
      cap: 2,
    })
    expect(out).toEqual(['stores/mistake-patterns.ts', 'middleware.ts'])
  })

  it('round-robins across top-level directories inside a tier', () => {
    const big = [
      ...Array.from({ length: 10 }, (_, i) => `src/a${i}.ts`),
      'lib/one.ts',
      'stores/one.ts',
    ]
    const out = priority.prioritizeSweepFiles(big, { cap: 3 })
    expect(new Set(out.map((p) => p.split('/')[0]))).toEqual(new Set(['src', 'lib', 'stores']))
  })

  it('ignores frame paths that are not in the tree and never exceeds the cap', () => {
    const out = priority.prioritizeSweepFiles(tree, { framePaths: ['gone.ts'], cap: 1 })
    expect(out).toHaveLength(1)
    expect(out[0]).not.toBe('gone.ts')
    expect(priority.prioritizeSweepFiles(tree, { cap: 0 })).toEqual([])
  })
})
