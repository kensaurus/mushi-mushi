/**
 * FILE: apps/admin/src/lib/projectMushiEnv.ts
 * PURPOSE: Map a project's slug to the env-var names its real codebase uses.
 *          Diagnostics and copy snippets previously hard-coded
 *          NEXT_PUBLIC_MUSHI_* everywhere, which misled Expo (yen-yen),
 *          Vite admin dogfood (mushi-mushi), and Vite SPA (solo-boss-cloud)
 *          integrators during setup.
 */

export interface ProjectMushiCiVar {
  name: string
  /** GitHub Actions storage — vars are visible in logs; secrets are masked. */
  ghKind: 'variable' | 'secret'
}

export interface ProjectMushiEnvVars {
  projectIdVar: string
  apiKeyVar: string
  endpointVar?: string
  /** Where operators typically paste credentials for this stack. */
  envFileHint?: string
  stackLabel: string
  /** GitHub repo vars/secrets for CI store builds (Expo EAS / release-mobile). */
  ciVars?: {
    projectId: ProjectMushiCiVar
    apiKey: ProjectMushiCiVar
    endpoint?: ProjectMushiCiVar
  }
}

const DEFAULT_WEB: ProjectMushiEnvVars = {
  projectIdVar: 'NEXT_PUBLIC_MUSHI_PROJECT_ID',
  apiKeyVar: 'NEXT_PUBLIC_MUSHI_API_KEY',
  endpointVar: 'NEXT_PUBLIC_MUSHI_API_ENDPOINT',
  stackLabel: 'Next.js / web',
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** Normalise a project slug for comparisons (exported for UI call sites). */
export function normalizeProjectSlug(slug: string | null | undefined): string {
  return normalizeSlug(slug ?? '')
}

/** True for Expo reporter stacks that use EXPO_PUBLIC_MUSHI_* (currently yen-yen). */
export function isExpoReporterProject(slug: string | null | undefined): boolean {
  const s = normalizeProjectSlug(slug)
  return s === 'yen-yen' || s === 'yenyen'
}

/** Default GitHub repo for Expo reporter CI vars when slug maps to a known consumer. */
export function expoReporterGithubRepo(slug: string | null | undefined): string | null {
  return isExpoReporterProject(slug) ? 'kensaurus/yen-yen' : null
}

/** Resolve env-var naming for a project slug. Falls back to Next.js web vars. */
export function mushiEnvVarsForProjectSlug(slug: string | null | undefined): ProjectMushiEnvVars {
  const s = normalizeProjectSlug(slug)
  if (s === 'mushi-mushi' || s === 'mushimushi') {
    return {
      projectIdVar: 'VITE_MUSHI_SELF_PROJECT_ID',
      apiKeyVar: 'VITE_MUSHI_SELF_API_KEY',
      endpointVar: 'VITE_MUSHI_SELF_API_ENDPOINT',
      envFileHint: 'apps/admin/.env.local',
      stackLabel: 'Mushi admin console (Vite dogfood)',
    }
  }
  if (s === 'yen-yen' || s === 'yenyen') {
    return {
      projectIdVar: 'EXPO_PUBLIC_MUSHI_PROJECT_ID',
      apiKeyVar: 'EXPO_PUBLIC_MUSHI_API_KEY',
      endpointVar: 'EXPO_PUBLIC_MUSHI_API_ENDPOINT',
      envFileHint: 'apps/mobile/.env.local',
      stackLabel: 'Expo / React Native',
      ciVars: {
        projectId: { name: 'EXPO_PUBLIC_MUSHI_PROJECT_ID', ghKind: 'variable' },
        apiKey: { name: 'EXPO_PUBLIC_MUSHI_API_KEY', ghKind: 'secret' },
        endpoint: { name: 'EXPO_PUBLIC_MUSHI_API_ENDPOINT', ghKind: 'variable' },
      },
    }
  }
  if (s === 'solo-boss-cloud' || s === 'solobosscloud') {
    return {
      projectIdVar: 'VITE_MUSHI_PROJECT_ID',
      apiKeyVar: 'VITE_MUSHI_API_KEY',
      endpointVar: 'VITE_MUSHI_ENDPOINT',
      envFileHint: '.env.local',
      stackLabel: 'Vite SPA (solo-boss-cloud-documentation)',
    }
  }
  if (s === 'glot-it' || s === 'glotit') {
    return DEFAULT_WEB
  }
  return DEFAULT_WEB
}

export function formatEnvVarPair(env: ProjectMushiEnvVars): string {
  return `${env.projectIdVar} / ${env.apiKeyVar}`
}

/**
 * Public-env prefix that a given bundler actually inlines into the client
 * bundle. This is the heart of the Workstream B "kill per-slug hardcoding"
 * fix: instead of mapping a project *slug* to a guessed prefix (which silently
 * disabled the SDK whenever a repo wasn't on the allow-list), we derive the
 * prefix from the *detected framework* of the repo. The detection itself lives
 * in `frameworkDetect.ts`; this map turns its result into the right env names.
 *
 *  - Vite (react/vue/svelte SPA) → `VITE_`
 *  - Next.js / Remix / Gatsby    → `NEXT_PUBLIC_` (Next is the dominant case;
 *                                   the loader/data-attr path covers the rest)
 *  - Nuxt                        → `NUXT_PUBLIC_`
 *  - Expo / React Native         → `EXPO_PUBLIC_`
 *  - vanilla / unknown           → no prefix (use the universal loader script
 *                                   with `data-project` / `data-key`, which
 *                                   needs no bundler inlining at all)
 */
export type MushiBundlerKind =
  | 'vite'
  | 'next'
  | 'nuxt'
  | 'expo'
  | 'webpack'
  | 'none'

export interface MushiEnvPrefixInfo {
  /** The env-var prefix the bundler inlines, e.g. `VITE_`. Empty for `none`. */
  prefix: string
  /** Whether this stack needs build-time inlining at all. */
  buildTimeInlined: boolean
  /** Human label for the configurator. */
  bundlerLabel: string
}

const BUNDLER_PREFIX: Record<MushiBundlerKind, MushiEnvPrefixInfo> = {
  vite: { prefix: 'VITE_', buildTimeInlined: true, bundlerLabel: 'Vite' },
  next: { prefix: 'NEXT_PUBLIC_', buildTimeInlined: true, bundlerLabel: 'Next.js' },
  nuxt: { prefix: 'NUXT_PUBLIC_', buildTimeInlined: true, bundlerLabel: 'Nuxt' },
  expo: { prefix: 'EXPO_PUBLIC_', buildTimeInlined: true, bundlerLabel: 'Expo' },
  webpack: { prefix: 'NEXT_PUBLIC_', buildTimeInlined: true, bundlerLabel: 'Webpack/CRA' },
  none: { prefix: '', buildTimeInlined: false, bundlerLabel: 'No build (loader script)' },
}

/** Map a detected framework name (from frameworkDetect) to its bundler kind. */
export function bundlerKindForFramework(framework: string | null | undefined): MushiBundlerKind {
  switch (framework) {
    case 'vue':
    case 'svelte':
      // Vue/Svelte SPAs are overwhelmingly Vite-powered in 2026. Nuxt/Next
      // metas are handled by their own detection branch upstream.
      return 'vite'
    case 'react':
      // React is ambiguous (Vite vs Next vs CRA). The detector tags Next.js
      // separately via reason text; callers that know it's Next pass 'next'.
      return 'vite'
    case 'next':
      // A caller that has resolved the repo to Next.js (e.g. via the detector's
      // `reason` text or a direct `hasDep(pkg,'next')` check) passes 'next' so
      // the SDK env vars get the build-time-inlined `NEXT_PUBLIC_` prefix.
      // Without this case the value fell through to 'none' → unprefixed
      // `MUSHI_PROJECT_ID`, which a Next bundle never inlines, silently
      // disabling the SDK.
      return 'next'
    case 'nuxt':
      // Symmetric to 'next': Vue is ambiguous (Vite vs Nuxt); a caller that
      // knows it's Nuxt passes 'nuxt' for the `NUXT_PUBLIC_` prefix.
      return 'nuxt'
    case 'react-native':
    case 'expo':
      return 'expo'
    case 'vanilla':
      return 'none'
    default:
      return 'none'
  }
}

/**
 * Resolve env-var naming from a detected bundler kind. Prefer this over
 * `mushiEnvVarsForProjectSlug` whenever a repo `package.json` has been
 * inspected — it is accurate for *any* repo, not just the hardcoded few.
 */
export function mushiEnvVarsForBundler(kind: MushiBundlerKind): ProjectMushiEnvVars {
  const info = BUNDLER_PREFIX[kind]
  if (kind === 'none') {
    // Loader-script path: no env inlining; credentials come from data-attrs.
    return {
      projectIdVar: 'MUSHI_PROJECT_ID',
      apiKeyVar: 'MUSHI_API_KEY',
      endpointVar: 'MUSHI_API_ENDPOINT',
      envFileHint: '(use the loader <script> data-project / data-key attributes)',
      stackLabel: info.bundlerLabel,
    }
  }
  return {
    projectIdVar: `${info.prefix}MUSHI_PROJECT_ID`,
    apiKeyVar: `${info.prefix}MUSHI_API_KEY`,
    endpointVar: `${info.prefix}MUSHI_API_ENDPOINT`,
    envFileHint: kind === 'expo' ? 'apps/mobile/.env.local' : '.env.local',
    stackLabel: info.bundlerLabel,
  }
}

export function bundlerPrefixInfo(kind: MushiBundlerKind): MushiEnvPrefixInfo {
  return BUNDLER_PREFIX[kind]
}
