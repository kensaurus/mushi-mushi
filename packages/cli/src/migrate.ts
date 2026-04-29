/**
 * FILE: packages/cli/src/migrate.ts
 * PURPOSE: `mushi migrate` — read the project's package.json and suggest
 *          the most relevant migration guide(s) on docs.mushimushi.dev.
 *
 * DETECTION
 *   - Competitor SDKs (the GTM win): Instabug/Luciq, Shake, LogRocket,
 *     BugHerd, Pendo. Match against npm package names that are stable
 *     across vendor releases.
 *   - "In-transition" shapes (the customer-impact win): a project that
 *     has BOTH `@capacitor/core` AND `react-native` is mid-port; suggest
 *     the Cap → RN guide and the in-progress checklist on the docs page.
 *   - Legacy shapes (the cleanup win): `cordova` (suggest Cordova → Cap),
 *     `react-scripts` (suggest CRA → Vite), `vue@^2` (suggest Vue 2 → 3).
 *
 * OUTPUT
 *   - Pretty: a short list of suggestions with full URLs, exits 0 on
 *     match, 1 on no match (so it composes well in `if mushi migrate;`
 *     scripts).
 *   - JSON: machine-readable with `--json` for CI / IDE agents.
 *
 * NON-GOALS
 *   - We never modify the project. The CLI's only side effect is stdout.
 *   - No automated codemods. The hub's docs delegate those to upstream
 *     tools (Tailwind upgrade, migrate-to-vite, expo prebuild, etc.).
 *
 * SOURCE OF TRUTH
 *   - The catalog of guides + their detection signals lives in this file
 *     to avoid a runtime dependency from CLI -> docs app. It MUST stay in
 *     sync with `apps/docs/content/migrations/_catalog.ts`. The two files
 *     each have a comment pointing at the other; if you add a guide,
 *     update both.
 */

import { readPackageJson } from './detect.js'

const DOCS_BASE = 'https://docs.mushimushi.dev'

export type MigrateCategory = 'mobile' | 'web' | 'competitor' | 'sdk-upgrade'
export type MigrateStatus = 'published' | 'draft'

export interface MigrateGuide {
  /** URL slug — `/migrations/<slug>` on docs.mushimushi.dev. */
  slug: string
  title: string
  summary: string
  category: MigrateCategory
  status: MigrateStatus
  /** Heuristic name for human output ("Detected: instabug-reactnative"). */
  detectionLabel?: string
  /**
   * Custom matcher run against the set of dependency names found in
   * package.json. Keep these tiny — one boolean per guide.
   */
  match?: (deps: ReadonlySet<string>) => boolean
}

/** Packages that, if present, suggest the matching competitor migration. */
const COMPETITOR_PACKAGES: Record<string, string[]> = {
  'instabug-to-mushi': [
    'instabug-reactnative',
    'luciq-reactnative-sdk',
    '@instabug/web',
    'instabug',
  ],
  'shake-to-mushi': [
    '@shakebugs/react-native-shake',
    '@shakebugs/shake-react-native',
    '@softnoesis/shakebug-js',
  ],
  'logrocket-feedback-to-mushi': ['logrocket', 'logrocket-react'],
  'bugherd-to-mushi': ['bugherd-pubsub'],
  'pendo-feedback-to-mushi': ['pendo-io-browser', '@pendo/web'],
}

/** Internal catalog. Order matters: in-transition shapes come first so we
 *  surface them above one-shot legacy detections. */
export const MIGRATE_CATALOG: readonly MigrateGuide[] = [
  // ── In-transition / cross-stack shapes (highest priority) ─────────
  {
    slug: 'capacitor-to-react-native',
    title: 'Capacitor → React Native',
    summary:
      'Looks like you have BOTH Capacitor and React Native installed — finishing this port? See the full Cap → RN plan.',
    category: 'mobile',
    status: 'published',
    detectionLabel: '@capacitor/core + react-native',
    match: (d) => d.has('@capacitor/core') && d.has('react-native'),
  },
  {
    slug: 'cordova-to-capacitor',
    title: 'Cordova → Capacitor',
    summary:
      'Cordova detected. Migrate in place to Capacitor for the modern WebView, plugin ecosystem, and first-party Mushi support.',
    category: 'mobile',
    status: 'published',
    detectionLabel: 'cordova',
    match: (d) => d.has('cordova') || d.has('cordova-android') || d.has('cordova-ios'),
  },

  // ── Web framework legacy shapes ───────────────────────────────────
  {
    slug: 'cra-to-vite',
    title: 'Create React App → Vite',
    summary:
      'react-scripts detected. CRA is unmaintained — `npx migrate-to-vite@latest cra` covers ~90 % of the move.',
    category: 'web',
    status: 'published',
    detectionLabel: 'react-scripts',
    match: (d) => d.has('react-scripts'),
  },

  // ── Competitor packages ───────────────────────────────────────────
  ...Object.entries(COMPETITOR_PACKAGES).map(([slug, pkgs]): MigrateGuide => ({
    slug,
    title: titleForCompetitor(slug),
    summary: `Found ${pkgs.join(' / ')} — Mushi covers the same surface with built-in AI triage and a Shadow-DOM widget.`,
    category: 'competitor',
    status: 'published',
    detectionLabel: pkgs[0],
    match: (d) => pkgs.some((p) => d.has(p)),
  })),
] as const

function titleForCompetitor(slug: string): string {
  switch (slug) {
    case 'instabug-to-mushi':
      return 'Instabug (Luciq) → Mushi'
    case 'shake-to-mushi':
      return 'Shake → Mushi'
    case 'logrocket-feedback-to-mushi':
      return 'LogRocket Feedback → Mushi'
    case 'bugherd-to-mushi':
      return 'BugHerd → Mushi'
    case 'pendo-feedback-to-mushi':
      return 'Pendo Feedback → Mushi'
    default:
      return slug
  }
}

export interface MigrateMatch {
  guide: MigrateGuide
  url: string
}

/** Pure detection. Easy to unit-test without filesystem mocking.
 *
 *  The optional `catalog` parameter exists so the "drafts never surface"
 *  property can be exercised with a synthetic catalog in tests — without
 *  it, every prod entry happens to be `published` so the filter branch
 *  would never run and a regression that flipped the predicate to
 *  `g.status !== 'published'` would slip through unit tests. Production
 *  callers pass nothing and get the real catalog. */
export function detectMigrations(
  deps: ReadonlySet<string>,
  catalog: readonly MigrateGuide[] = MIGRATE_CATALOG,
): MigrateMatch[] {
  return catalog
    .filter((g) => g.status === 'published' && g.match?.(deps))
    .map((g) => ({ guide: g, url: `${DOCS_BASE}/migrations/${g.slug}` }))
}

/** Build the dep set the way `mushi migrate` will see it from a real
 *  `package.json`. Exposed for tests. */
export function depsFromPackageJson(pkg: {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
} | null): Set<string> {
  if (!pkg) return new Set()
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
}

export interface RunMigrateOptions {
  cwd?: string
  json?: boolean
  /** When set, log via this fn instead of console.log — used by tests. */
  log?: (line: string) => void
}

/** `mushi migrate` entry point. Returns the suggestion count so the
 *  command handler can `process.exit(matches.length === 0 ? 1 : 0)`. */
export function runMigrate(opts: RunMigrateOptions = {}): {
  matches: MigrateMatch[]
} {
  const cwd = opts.cwd ?? process.cwd()
  const log = opts.log ?? ((s: string) => console.log(s))

  const pkg = readPackageJson(cwd)
  if (!pkg) {
    log(
      opts.json
        ? JSON.stringify({ ok: false, error: 'no-package-json', cwd, matches: [] }, null, 2)
        : `No package.json found in ${cwd}. Run \`mushi migrate\` from your project root.`,
    )
    return { matches: [] }
  }

  const deps = depsFromPackageJson(pkg)
  const matches = detectMigrations(deps)

  if (opts.json) {
    log(
      JSON.stringify(
        {
          ok: true,
          cwd,
          matches: matches.map((m) => ({
            slug: m.guide.slug,
            title: m.guide.title,
            url: m.url,
            category: m.guide.category,
            detectionLabel: m.guide.detectionLabel,
          })),
        },
        null,
        2,
      ),
    )
    return { matches }
  }

  if (matches.length === 0) {
    log('No migrations suggested for this project.')
    log(`Browse the full catalog: ${DOCS_BASE}/migrations`)
    return { matches }
  }

  log(`Suggested migration${matches.length > 1 ? 's' : ''} for this project:`)
  log('')
  for (const { guide, url } of matches) {
    log(`  • ${guide.title}`)
    if (guide.detectionLabel) log(`    detected: ${guide.detectionLabel}`)
    log(`    ${guide.summary}`)
    log(`    ${url}`)
    log('')
  }
  log(`Browse the full catalog: ${DOCS_BASE}/migrations`)
  return { matches }
}
