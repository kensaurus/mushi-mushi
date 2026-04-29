/**
 * FILE: apps/admin/src/lib/migrationsCatalog.ts
 * PURPOSE: Slug → display metadata mapping for the admin's MigrationsInProgressCard.
 *
 * The docs site owns the canonical CATALOG (apps/docs/content/migrations/_catalog.ts);
 * we mirror just the fields the admin card needs (title + summary + docs URL)
 * so the card can render without making the admin import the docs package.
 *
 * Sync invariant (enforced by scripts/check-migration-catalog-sync.mjs):
 *   - Every published slug in the docs catalog MUST appear here.
 *   - Every slug here MUST exist in the docs catalog.
 *   - Titles are kept identical so deep-link cards match the docs hero.
 */

const DOCS_BASE = 'https://docs.mushimushi.dev/migrations'

export interface AdminMigrationGuideMeta {
  slug: string
  title: string
  summary: string
}

export const MIGRATIONS_CATALOG: readonly AdminMigrationGuideMeta[] = [
  {
    slug: 'capacitor-to-react-native',
    title: 'Capacitor → React Native',
    summary:
      'Full porting plan with EAS Build / Fastlane CI recipes, plugin map, and the Mushi SDK swap.',
  },
  {
    slug: 'cordova-to-capacitor',
    title: 'Cordova → Capacitor',
    summary:
      'Replace Cordova in place. Plugin map, build pipeline swap, splash regen, Mushi widget reconfig.',
  },
  {
    slug: 'cordova-to-react-native',
    title: 'Cordova → React Native',
    summary: 'Two-hop migration: Capacitor first, then port to React Native.',
  },
  {
    slug: 'react-native-cli-to-expo',
    title: 'React Native CLI ↔ Expo',
    summary: 'Add Expo modules to a bare CLI app, or eject Expo with `expo prebuild`.',
  },
  {
    slug: 'native-to-hybrid',
    title: 'Native iOS / Android → Hybrid',
    summary: 'Wrap an existing native app shell with Capacitor or React Native.',
  },
  {
    slug: 'cra-to-vite',
    title: 'Create React App → Vite',
    summary: 'CRA is unmaintained. Run the codemod, then handle the manual breaking changes.',
  },
  {
    slug: 'nextjs-pages-to-app-router',
    title: 'Next.js Pages → App Router',
    summary: 'Page-by-page move with the right MushiProvider placement and CSP-aware static export.',
  },
  {
    slug: 'vue-2-to-vue-3',
    title: 'Vue 2 → Vue 3',
    summary: 'Composition API migration with @mushi-mushi/vue peer-dep alignment.',
  },
  {
    slug: 'spa-to-ssr',
    title: 'SPA → SSR (Next.js / Nuxt / SvelteKit)',
    summary: 'Move from a Vite SPA to a server-rendered framework with env-var prefix mapping.',
  },
  {
    slug: 'instabug-to-mushi',
    title: 'Instabug (Luciq) → Mushi',
    summary: 'Rebrand-aware API mapping: Luciq.init → Mushi.init, identifyUser → setUser.',
  },
  {
    slug: 'shake-to-mushi',
    title: 'Shake → Mushi',
    summary: 'Shake.start(apiKey) → Mushi.init, addEventKey → setMetadata.',
  },
  {
    slug: 'logrocket-feedback-to-mushi',
    title: 'LogRocket Feedback → Mushi',
    summary: 'Move bug-feedback off LogRocket without losing session replay.',
  },
  {
    slug: 'bugherd-to-mushi',
    title: 'BugHerd → Mushi',
    summary: 'Sidebar feedback widget → Mushi shake/button widget with element selector + screenshot.',
  },
  {
    slug: 'pendo-feedback-to-mushi',
    title: 'Pendo Feedback → Mushi',
    summary: 'pendo.identify → Mushi.setUser, route-tracking → Mushi.setScreen.',
  },
  {
    slug: 'mushi-sdk-upgrade',
    title: '@mushi-mushi/* 0.x → 1.0',
    summary: 'Forward-looking upgrade rail tracking each package\'s breaking changes.',
  },
] as const

const SLUG_TO_META = new Map<string, AdminMigrationGuideMeta>(
  MIGRATIONS_CATALOG.map((g) => [g.slug, g]),
)

export function findGuideMeta(slug: string): AdminMigrationGuideMeta | null {
  return SLUG_TO_META.get(slug) ?? null
}

export function docsUrlForGuide(slug: string, projectId?: string | null): string {
  const base = `${DOCS_BASE}/${slug}`
  if (!projectId) return base
  // Hash so the docs sync hook can pick up a hint of which project the user
  // expects to work in. The bridge already negotiates the project, so this
  // is purely informational — clean URL for shareability.
  return `${base}#project=${encodeURIComponent(projectId)}`
}

export const MIGRATIONS_CATALOG_SLUGS: readonly string[] = MIGRATIONS_CATALOG.map((g) => g.slug)
