/**
 * FILE: apps/admin/src/lib/projectMushiEnv.ts
 * PURPOSE: The env-var names an app's codebase uses for Mushi, from its
 *          detected framework (`next` / `nuxt` / `vite` / `expo` …), never
 *          from its name. Plan 025 P0 / ADR 0072: no product code path
 *          special-cases a tenant. Without a detected framework the names are
 *          the Next.js public ones (`NEXT_PUBLIC_MUSHI_*`), never bare
 *          `MUSHI_*` names a bundler drops. The operator's own console (the
 *          project in VITE_MUSHI_SELF_PROJECT_ID, config) gets its
 *          `VITE_MUSHI_SELF_*` names.
 */

interface ProjectMushiCiVar {
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

const SELF_ENV: ProjectMushiEnvVars = {
  projectIdVar: 'VITE_MUSHI_SELF_PROJECT_ID',
  apiKeyVar: 'VITE_MUSHI_SELF_API_KEY',
  endpointVar: 'VITE_MUSHI_SELF_API_ENDPOINT',
  envFileHint: 'apps/admin/.env.local',
  stackLabel: 'Mushi Mushi admin console (Vite dogfood)',
}

/** The project this console reports its own bugs to (VITE_MUSHI_SELF_PROJECT_ID), when configured. */
export function isMushiSelfProject(projectId: string | null | undefined, selfProjectId: string | undefined = import.meta.env?.VITE_MUSHI_SELF_PROJECT_ID): boolean {
  return Boolean(projectId && selfProjectId && projectId === selfProjectId)
}

/** True when the names are an Expo / React Native app's (`EXPO_PUBLIC_*`). */
export function isExpoEnv(env: Pick<ProjectMushiEnvVars, 'projectIdVar'>): boolean {
  return env.projectIdVar.startsWith('EXPO_PUBLIC_')
}

/**
 * Env-var naming for a project. Pass `framework` when a connected repo (or
 * the CLI detector) named the bundler: `next` / `nextjs` → `NEXT_PUBLIC_`,
 * `nuxt` → `NUXT_PUBLIC_`, `vue` / `svelte` / `react` / `vite` → `VITE_`,
 * `expo` / `react-native` → `EXPO_PUBLIC_`. Unknown or none → `NEXT_PUBLIC_`.
 * `isSelf`: the operator's own console project (isMushiSelfProject).
 */
export function mushiEnvVarsForProject(opts: { framework?: string | null; isSelf?: boolean } = {}): ProjectMushiEnvVars {
  if (opts.isSelf) return SELF_ENV
  if (opts.framework) {
    const kind = bundlerKindForFramework(opts.framework)
    // `none` is "no bundler", not "Next": keep the NEXT_PUBLIC_ default so an
    // unrecognised id cannot fall through to unprefixed MUSHI_*.
    if (kind !== 'none') return mushiEnvVarsForBundler(kind)
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

interface MushiEnvPrefixInfo {
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

/**
 * Map a detected framework name to its bundler kind.
 * Callers that have resolved Next.js or Nuxt (package.json `next` / `nuxt`,
 * or the diagnostic stack id `nextjs`) must pass that id. `react` alone is
 * ambiguous and maps to Vite; passing it for a Next app would emit `VITE_`.
 */
export function bundlerKindForFramework(framework: string | null | undefined): MushiBundlerKind {
  switch (framework) {
    case 'vite':
    case 'vue':
    case 'svelte':
      // Vue/Svelte SPAs are overwhelmingly Vite-powered. Nuxt/Next are
      // their own cases — a Nuxt app also depends on Vite.
      return 'vite'
    case 'react':
      // React is ambiguous (Vite vs Next vs CRA). Callers that know it's
      // Next pass 'next' or 'nextjs'.
      return 'vite'
    case 'next':
    case 'nextjs':
      // Without this case the value fell through to 'none' → unprefixed
      // MUSHI_PROJECT_ID, which a Next bundle never inlines, silently
      // disabling the SDK.
      return 'next'
    case 'nuxt':
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

/** Env-var naming from a detected bundler kind (mushiEnvVarsForProject calls it). */
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
    envFileHint: '.env.local',
    stackLabel: kind === 'expo' ? 'Expo / React Native' : info.bundlerLabel,
    // Store builds read public env at build time: CI must carry the same names.
    ...(kind === 'expo'
      ? {
          ciVars: {
            projectId: { name: 'EXPO_PUBLIC_MUSHI_PROJECT_ID', ghKind: 'variable' as const },
            apiKey: { name: 'EXPO_PUBLIC_MUSHI_API_KEY', ghKind: 'secret' as const },
            endpoint: { name: 'EXPO_PUBLIC_MUSHI_API_ENDPOINT', ghKind: 'variable' as const },
          },
        }
      : {}),
  }
}
