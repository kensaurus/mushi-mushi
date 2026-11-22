import { describe, expect, it } from 'vitest'
import { absentHeldByWrapper, auditCategory, auditPatternKey, enclosingComponents, evidenceTag, parseImports, patternRoot, resolveComponent, resolveImport } from './audit-patterns.js'

/**
 * A slice of glot.it on 2026-11-21 (origin/main 74c8122ea): the shared shell
 * gained its live region on 2026-10-30, yet the per-page "screen reader hears
 * nothing while X loads" findings stayed open. Pricing renders the shell; Chat
 * does not.
 */
const REPO: Record<string, string> = {
  'components/route-loading-shell.tsx': [
    '"use client";',
    'import { type ReactNode, useEffect, useState } from "react";',
    'import { Button } from "@/design-system";',
    'export function RouteLoadingShell({ children }: { children: ReactNode }) {',
    '  return (',
    '    <>',
    '      {children}',
    '      <div role="alert" aria-live="assertive" aria-atomic="true" />',
    '    </>',
    '  );',
    '}',
  ].join('\n'),
  'components/page-scaffold.tsx': 'export function PageScaffold({ children }) { return <main>{children}</main> }',
  'design-system/index.ts': "export * from './primitives/skeleton'\nexport { Button } from './primitives/button'",
  'design-system/primitives/skeleton.tsx': 'export function Skeleton({ className }) { return <div className={className} /> }',
  'design-system/primitives/button.tsx': 'export function Button() { return <button /> }',
  'app/pricing/loading.tsx': [
    '"use client";', // 1
    '', // 2
    'import { useTranslation } from "react-i18next";', // 3
    'import { Skeleton } from "@/design-system";', // 4
    'import { PageScaffold } from "@/components/page-scaffold";', // 5
    'import { RouteLoadingShell } from "@/components/route-loading-shell";', // 6
    '', // 7
    'export default function PricingLoading() {', // 8
    '  const { t } = useTranslation(["misc", "common"]);', // 9
    '', // 10
    '  return (', // 11
    '    <RouteLoadingShell>', // 12
    '    <PageScaffold>', // 13
    '      <h1 className="sr-only">{t("pricing")}</h1>', // 14
    '      <Skeleton className="h-4 w-32" />', // 15
    '    </PageScaffold>', // 16
    '    </RouteLoadingShell>', // 17
    '  );', // 18
    '}', // 19
  ].join('\n'),
  'app/chat/loading.tsx': [
    '"use client";', // 1
    '', // 2
    'import { Skeleton } from "@/design-system";', // 3
    '', // 4
    'export default function ChatLoading() {', // 5
    '  return (', // 6
    '    <div className="flex min-h-0 flex-1 flex-col h-0">', // 7
    '      <Skeleton className="min-h-[4rem] w-full" />', // 8
    '    </div>', // 9
    '  );', // 10
    '}', // 11
  ].join('\n'),
}
const read = (p: string) => REPO[p] ?? null
const exists = (p: string) => p in REPO
const LIVE = /aria-busy|aria-live|role="status"/

describe('the fixed category (ADR 0063)', () => {
  it('reads the rule, title and user impact together, so a free-text slug still lands in one category', () => {
    expect(auditCategory({ rule: 'loading-status-missing', title: 'Screen reader hears nothing while Events loads' })).toBe('a11y-loading-silent')
    expect(auditCategory({ rule: 'silent-loading-state', title: 'Admin loading screen is silent' })).toBe('a11y-loading-silent')
    expect(auditCategory({ rule: 'discover-status-hidden', title: 'Discover loading and error never show' })).toBe('error-state')
    expect(auditCategory({ rule: 'error-shown-as-empty', title: 'A failed load looks like an empty question list' })).toBe('error-state')
    expect(auditCategory({ rule: 'blank-redirect', title: 'More opens as a blank page' })).toBe('loading-state')
    expect(auditCategory({ rule: 'offline-false-empty', title: 'Saved counts show zero while offline data is still loading' })).toBe('offline-state')
    expect(auditCategory({ rule: 'tiny-tap-target', title: 'Coach mark Got it is too small to tap' })).toBe('control-hard-to-use')
    expect(auditCategory({ rule: 'gloss-clipped', title: 'English meaning is cut off on a phone' })).toBe('overflow')
    expect(auditCategory({ rule: 'untranslated-send-error', title: 'Failed send shows an English error' })).toBe('untranslated')
    expect(auditCategory({ rule: 'events-copy-untranslated', title: 'Events page stays in English' })).toBe('untranslated')
    expect(auditCategory({ rule: 'review-count-plural', title: 'Resume button says Review 1 words' })).toBe('wrong-number')
    expect(auditCategory({ rule: 'retry-button-contrast', title: 'Retry looks like faint red text' })).toBe('error-state')
    expect(auditCategory({ rule: 'kreng-jai-romanization', title: 'เกรงใจ is written greeng jai' })).toBe('other')
  })

  it('keys a pattern by category and root; an `other` finding keeps its rule so two unrelated problems stay two', () => {
    expect(auditPatternKey('a11y-loading-silent', 'app/**/loading.tsx', 'loading-status-missing')).toBe('a11y-loading-silent:app/**/loading.tsx')
    expect(auditPatternKey('other', 'app/a.tsx', 'wrong-tone')).toBe('other:wrong-tone:app/a.tsx')
    expect(auditPatternKey('made-up', 'app/a.tsx', 'x')).toBe('other:x:app/a.tsx')
  })
})

describe('imports and the root component', () => {
  it('reads local and package imports, named, aliased and default', () => {
    const m = parseImports('import A from "./a"\nimport { B, C as D, type E } from "@/x"\nimport type { F } from "./f"\nimport * as G from "g"')
    expect([...m.entries()]).toEqual([['A', './a'], ['B', '@/x'], ['D', '@/x']])
  })

  it('resolves the repo-root alias, relative paths and index files; never a package', () => {
    expect(resolveImport('app/pricing/loading.tsx', '@/components/route-loading-shell', exists)).toBe('components/route-loading-shell.tsx')
    expect(resolveImport('design-system/index.ts', './primitives/skeleton', exists)).toBe('design-system/primitives/skeleton.tsx')
    expect(resolveImport('app/pricing/loading.tsx', '@/design-system', exists)).toBe('design-system/index.ts')
    expect(resolveImport('app/pricing/loading.tsx', 'react-i18next', exists)).toBeNull()
    expect(resolveImport('app/a.tsx', '../../../etc/passwd', exists)).toBeNull()
  })

  it('follows one barrel to the component itself', () => {
    const imports = parseImports(REPO['app/pricing/loading.tsx']!)
    expect(resolveComponent('app/pricing/loading.tsx', 'Skeleton', imports, read, exists)).toBe('design-system/primitives/skeleton.tsx')
  })

  it('the root is the shared component the evidence renders, else the route kind, else the file', () => {
    const src = REPO['app/chat/loading.tsx']!
    expect(evidenceTag('<Skeleton className="h-4" />')).toBe('Skeleton')
    expect(patternRoot('app/chat/loading.tsx', '<Skeleton className="min-h-[4rem] w-full" />', src, read, exists)).toBe('design-system/primitives/skeleton.tsx')
    expect(patternRoot('app/chat/loading.tsx', '<div className="flex min-h-0 flex-1 flex-col h-0">', src, read, exists)).toBe('app/**/loading.tsx')
    expect(patternRoot('src/features/x/panel.tsx', '<div>', null, read, exists)).toBe('src/features/x/panel.tsx')
  })
})

describe('an absent problem a shared wrapper already solves', () => {
  it('finds the imported components whose element encloses the line, never a self-closing one', () => {
    expect(enclosingComponents(REPO['app/pricing/loading.tsx']!, 14).sort()).toEqual(['PageScaffold', 'RouteLoadingShell'])
    expect(enclosingComponents(REPO['app/chat/loading.tsx']!, 7)).toEqual([])
  })

  it('pricing closes: RouteLoadingShell around line 14 has the live region', () => {
    expect(absentHeldByWrapper('app/pricing/loading.tsx', REPO['app/pricing/loading.tsx']!, 14, LIVE, read, exists)).toBe('components/route-loading-shell.tsx')
  })

  it('chat stays open: nothing around line 7 has it', () => {
    expect(absentHeldByWrapper('app/chat/loading.tsx', REPO['app/chat/loading.tsx']!, 7, LIVE, read, exists)).toBeNull()
    expect(absentHeldByWrapper('app/pricing/loading.tsx', REPO['app/pricing/loading.tsx']!, null, LIVE, read, exists)).toBeNull()
  })
})
