/**
 * FILE: apps/docs/content/migrations/_catalog.ts
 * PURPOSE: Single source of truth for every migration guide's metadata.
 *
 *   - The hub index page renders <MigrationHub guides={CATALOG} /> and uses
 *     this to drive category chips, search, effort/risk filters, and the
 *     grid cards themselves.
 *   - The CLI `mushi migrate` subcommand maintains a PARALLEL catalog at
 *     `packages/cli/src/migrate.ts` (kept separate to avoid a runtime dep
 *     from the CLI on the docs app). Both catalogs MUST stay in sync —
 *     when adding a guide here, mirror the slug + `status` + detection
 *     packages over there too. The CLI's `MIGRATE_CATALOG` only surfaces
 *     entries with `status: 'published'`, pinned by `migrate.test.ts`.
 *   - Tests pin that every CATALOG entry has a corresponding `.mdx` file
 *     under apps/docs/content/migrations/ so we never link to a 404.
 *
 * Adding a guide: append an entry below, write the matching MDX file, run
 * the docs build. Order in this array IS the display order on the hub.
 */

export type MigrationCategory = 'mobile' | 'web' | 'competitor' | 'sdk-upgrade'
export type MigrationEffort = 'Hours' | 'Days' | 'Weeks'
export type MigrationRisk = 'Low' | 'Med' | 'High'
export type MigrationStatus = 'published' | 'draft'

export interface GuideMeta {
  /** Slug under /migrations/. The MDX file at
   *  `apps/docs/content/migrations/<slug>.mdx` MUST exist. */
  slug: string
  /** Card title. Keep it scannable — "<from> -> <to>". */
  title: string
  /** ~1 sentence shown on the hub grid card and in CLI suggestions. */
  summary: string
  category: MigrationCategory
  effort: MigrationEffort
  risk: MigrationRisk
  /** When 'draft', the hub shows a muted "draft" badge and the CLI hides
   *  the suggestion. Use for placeholder guides we want to surface in the
   *  IA but not yet promise users will work end-to-end. */
  status: MigrationStatus
  /**
   * npm/JSR package names (or canonical npm slug strings) that, if present
   * in a project's `package.json`, indicate this migration applies. Used by
   * `mushi migrate` to suggest the right guide. Empty for guides driven by
   * project shape only (e.g. SPA -> SSR is detected via `next.config` etc.).
   */
  detectPackages?: readonly string[]
  /**
   * Marketing label for the "from" stack — used by the marketing-site
   * "Switching from X?" strip and the docs hub's "Coming from X?" filter.
   * Omit when the guide is generic (e.g. SDK upgrade).
   */
  fromLabel?: string
}

export const CATEGORY_LABELS: Record<MigrationCategory, string> = {
  mobile: 'Mobile / hybrid',
  web: 'Web framework',
  competitor: 'Switch to Mushi',
  'sdk-upgrade': 'Mushi SDK upgrade',
}

export const CATEGORY_ORDER: readonly MigrationCategory[] = [
  'mobile',
  'web',
  'competitor',
  'sdk-upgrade',
]

/* ── Catalog ────────────────────────────────────────────────────────────
 * Display order: mobile first (highest cross-customer demand), then web
 * framework moves, then competitor->Mushi (a strategic GTM surface), then
 * the Mushi self-upgrade rail at the bottom.
 *
 * Every published entry was sanity-checked on 2026-04-29 against the
 * relevant upstream docs (Capacitor, Vite, Next.js, Vue, Expo, Luciq,
 * Shake, LogRocket, BugHerd, Pendo). Re-validate on each minor Mushi
 * release; the audit log lives in docs/migrations/. */
export const CATALOG: readonly GuideMeta[] = [
  // ── mobile / hybrid ────────────────────────────────────────────────
  {
    slug: 'capacitor-to-react-native',
    title: 'Capacitor → React Native',
    summary:
      'Full porting plan with both EAS Build and GitHub Actions + Fastlane CI/CD recipes, the plugin map, and the Mushi SDK swap.',
    category: 'mobile',
    effort: 'Weeks',
    risk: 'High',
    status: 'published',
    detectPackages: ['@capacitor/core'],
    fromLabel: 'Capacitor',
  },
  {
    slug: 'cordova-to-capacitor',
    title: 'Cordova → Capacitor',
    summary:
      'Replace Cordova with Capacitor in place. Plugin map, build pipeline swap, splash/icon regeneration, and Mushi widget reconfiguration.',
    category: 'mobile',
    effort: 'Days',
    risk: 'Med',
    status: 'published',
    detectPackages: ['cordova', 'cordova-android', 'cordova-ios'],
    fromLabel: 'Cordova',
  },
  {
    slug: 'cordova-to-react-native',
    title: 'Cordova → React Native',
    summary:
      'Two-hop migration: stabilise on Capacitor first, then port screen-by-screen to React Native. Preserves the Mushi project the whole way.',
    category: 'mobile',
    effort: 'Weeks',
    risk: 'High',
    status: 'published',
    detectPackages: ['cordova'],
    fromLabel: 'Cordova',
  },
  {
    slug: 'react-native-cli-to-expo',
    title: 'React Native CLI ↔ Expo',
    summary:
      'Both directions. Add Expo modules to a bare CLI app via install-expo-modules, or eject Expo with `expo prebuild`. Mushi works on both.',
    category: 'mobile',
    effort: 'Days',
    risk: 'Low',
    status: 'published',
    detectPackages: ['react-native', 'expo'],
    fromLabel: 'React Native CLI',
  },
  {
    slug: 'native-to-hybrid',
    title: 'Native iOS / Android → Hybrid',
    summary:
      'When and how to wrap an existing native app shell with Capacitor or React Native, keeping the platform Mushi SDKs in place.',
    category: 'mobile',
    effort: 'Weeks',
    risk: 'High',
    status: 'published',
    fromLabel: 'Native iOS / Android',
  },

  // ── web framework ──────────────────────────────────────────────────
  {
    slug: 'cra-to-vite',
    title: 'Create React App → Vite',
    summary:
      'CRA is unmaintained. Run `npx migrate-to-vite@latest cra` for the codemod, then handle the manual breaking changes (env vars, public/, types).',
    category: 'web',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['react-scripts'],
    fromLabel: 'Create React App',
  },
  {
    slug: 'nextjs-pages-to-app-router',
    title: 'Next.js Pages → App Router',
    summary:
      'Page-by-page move to App Router with the right Mushi `<MushiProvider>` placement and the CSP-aware integration for static export.',
    category: 'web',
    effort: 'Days',
    risk: 'Med',
    status: 'published',
    fromLabel: 'Next.js Pages Router',
  },
  {
    slug: 'vue-2-to-vue-3',
    title: 'Vue 2 → Vue 3',
    summary:
      'Composition API migration with `@mushi-mushi/vue` peer-dep alignment and the `app.use(MushiPlugin, ...)` shape.',
    category: 'web',
    effort: 'Days',
    risk: 'Med',
    status: 'published',
    detectPackages: ['vue'],
    fromLabel: 'Vue 2',
  },
  {
    slug: 'spa-to-ssr',
    title: 'SPA → SSR (Next.js / Nuxt / SvelteKit)',
    summary:
      'Move from a Vite SPA to a server-rendered framework. Mushi env-var prefix mapping (VITE_ → NEXT_PUBLIC_), provider placement, and hydration safety.',
    category: 'web',
    effort: 'Weeks',
    risk: 'Med',
    status: 'published',
    fromLabel: 'Vite SPA',
  },

  // ── competitor -> Mushi ────────────────────────────────────────────
  {
    slug: 'instabug-to-mushi',
    title: 'Instabug (Luciq) → Mushi',
    summary:
      'API mapping for the rebrand-aware migration: `Luciq.init` → `Mushi.init`, `identifyUser` → `setUser`, shake invocation parity.',
    category: 'competitor',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['instabug-reactnative', 'luciq-reactnative-sdk', '@instabug/web'],
    fromLabel: 'Instabug / Luciq',
  },
  {
    slug: 'shake-to-mushi',
    title: 'Shake → Mushi',
    summary:
      '`Shake.start(apiKey)` → `Mushi.init`, `addEventKey` → `setMetadata`, with a Mushi widget config that matches Shake\'s shake-to-report defaults.',
    category: 'competitor',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['@shakebugs/shake-react-native', '@softnoesis/shakebug-js'],
    fromLabel: 'Shake',
  },
  {
    slug: 'logrocket-feedback-to-mushi',
    title: 'LogRocket Feedback → Mushi',
    summary:
      'Move bug-feedback off LogRocket without losing session replay — keep LogRocket for replay, swap the feedback widget for Mushi, link the two via Mushi metadata.',
    category: 'competitor',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['logrocket', 'logrocket-react'],
    fromLabel: 'LogRocket Feedback',
  },
  {
    slug: 'bugherd-to-mushi',
    title: 'BugHerd → Mushi',
    summary:
      'Sidebar feedback widget → Mushi shake/button widget. Pixel-pin annotations replaced with Mushi\'s element selector + screenshot.',
    category: 'competitor',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['bugherd-pubsub'],
    fromLabel: 'BugHerd',
  },
  {
    slug: 'pendo-feedback-to-mushi',
    title: 'Pendo Feedback → Mushi',
    summary:
      '`pendo.identify` → `Mushi.setUser`, route-tracking → `Mushi.setScreen`, in-app guides → external feature flag (Pendo stays where it shines).',
    category: 'competitor',
    effort: 'Hours',
    risk: 'Low',
    status: 'published',
    detectPackages: ['pendo-io-browser', '@pendo/web'],
    fromLabel: 'Pendo Feedback',
  },

  // ── Mushi SDK upgrade ──────────────────────────────────────────────
  {
    slug: 'mushi-sdk-upgrade',
    title: '@mushi-mushi/* 0.x → 1.0',
    summary:
      'Forward-looking upgrade rail. Tracks each package\'s breaking changes as we approach 1.0 so customers can plan ahead.',
    category: 'sdk-upgrade',
    effort: 'Hours',
    risk: 'Low',
    status: 'draft',
  },
] as const

export const PUBLISHED_GUIDES: readonly GuideMeta[] = CATALOG.filter(
  (g) => g.status === 'published',
)

export function findGuideBySlug(slug: string): GuideMeta | undefined {
  return CATALOG.find((g) => g.slug === slug)
}
