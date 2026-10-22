/**
 * FILE: packages/server/supabase/functions/_shared/sdk-diagnostics.ts
 * PURPOSE: The pure half of the SDK CI-secret diagnostic: which Mushi env vars
 *          a stack needs in CI, the `gh secret set` fallback, native-origin
 *          detection from key heartbeats, and the fused status verdict.
 *
 * Extracted from api/routes/project-ci-secrets.ts so other routes (recipe,
 * portfolio) can read the required env names without importing a route
 * module, and so the verdict is unit-testable. No I/O here.
 */

export type SdkStack = 'nextjs' | 'nuxt' | 'expo' | 'vite'

export interface CiVar {
  name: string
  /** Deterministic value, set before calling sync. The API key slot holds the freshly minted key. */
  value?: string
  ghKind: 'secret' | 'variable'
  /**
   * Written by sync, but not required: the SDK already defaults to Mushi
   * Cloud's endpoint, so an app without it works. A self-hosted backend
   * still needs it.
   */
  optional?: true
}

/**
 * The Mushi CI vars a project needs, per stack (mirrors
 * apps/admin/src/lib/projectMushiEnv.ts). projectId and endpoint are
 * deterministic; the API key is the freshly minted one.
 */
export function buildCiVars(params: {
  stack: SdkStack
  projectId: string
  endpoint: string
  mintedKey: string
}): CiVar[] {
  const { stack, projectId, endpoint, mintedKey } = params
  const prefix =
    stack === 'expo' ? 'EXPO_PUBLIC_'
    : stack === 'nuxt' ? 'NUXT_PUBLIC_'
    : stack === 'vite' ? 'VITE_'
    : 'NEXT_PUBLIC_'
  return [
    { name: `${prefix}MUSHI_PROJECT_ID`, value: projectId, ghKind: 'variable' },
    { name: `${prefix}MUSHI_API_KEY`, value: mintedKey, ghKind: 'secret' },
    { name: `${prefix}MUSHI_API_ENDPOINT`, value: endpoint, ghKind: 'variable', optional: true },
  ]
}

/**
 * Required names (no values) for diagnosis and comparison. The endpoint is
 * left out: its absence is not a fault (see `CiVar.optional`).
 */
export function requiredCiVarNames(stack: SdkStack): Array<{ name: string; ghKind: 'secret' | 'variable' }> {
  return buildCiVars({ stack, projectId: '', endpoint: '', mintedKey: '' })
    .filter((v) => !v.optional)
    .map(({ name, ghKind }) => ({ name, ghKind }))
}

/** Every var sync writes, optional ones included: the guided fallback prints them all. */
export function ciVarTemplateNames(stack: SdkStack): Array<{ name: string; ghKind: 'secret' | 'variable' }> {
  return buildCiVars({ stack, projectId: '', endpoint: '', mintedKey: '' }).map(({ name, ghKind }) => ({ name, ghKind }))
}

/** Stack from the project slug (a heuristic until the recipe names the stack). */
export function inferStack(slug: string | null): SdkStack {
  if (!slug) return 'nextjs'
  const s = slug.toLowerCase()
  if (s === 'yen-yen') return 'expo'
  if (s === 'mushi-mushi' || s === 'solo-boss-cloud' || s === 'atpeak') return 'vite'
  return 'nextjs'
}

/** The package.json files a repo's stack is read from: the root and the usual app folders. */
export const STACK_PACKAGE_PATHS = [
  'package.json',
  'apps/mobile/package.json',
  'apps/web/package.json',
  'apps/app/package.json',
  'apps/admin/package.json',
  'src/package.json',
] as const

function dependencyNames(pkgText: string): string[] {
  let pkg: unknown
  try {
    pkg = JSON.parse(pkgText)
  } catch {
    return []
  }
  if (typeof pkg !== 'object' || pkg === null) return []
  const p = pkg as { dependencies?: unknown; devDependencies?: unknown }
  const keys = (v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v) : [])
  return [...keys(p.dependencies), ...keys(p.devDependencies)]
}

/**
 * Stack from the repo's package.json texts, so the env check expects the
 * names the bundler really inlines (EXPO_PUBLIC_, VITE_, NEXT_PUBLIC_, NUXT_PUBLIC_).
 * Files that depend on a Mushi SDK package are read first: in a monorepo
 * they are the app the SDK ships in. Expo / React Native wins over Next.js,
 * Next.js over Nuxt, and Nuxt over Vite. A Next or Nuxt app often lists
 * Vite as its bundler or test runner; matching Vite first would emit
 * `VITE_` names the framework never inlines. null when no file names a
 * known bundler; the caller falls back to the slug.
 */
export function stackFromPackageJsons(texts: readonly string[]): SdkStack | null {
  const all = texts.map(dependencyNames).filter((names) => names.length > 0)
  const withSdk = all.filter((names) => names.some((n) => n.startsWith('@mushi-mushi/')))
  const names = new Set((withSdk.length > 0 ? withSdk : all).flat())
  if (names.has('expo') || names.has('react-native')) return 'expo'
  if (names.has('next')) return 'nextjs'
  if (names.has('nuxt')) return 'nuxt'
  if (names.has('vite')) return 'vite'
  return null
}

/** The detected stack when there is one, else the slug heuristic. */
export function resolveStack(slug: string | null, detected: SdkStack | null | undefined): SdkStack {
  return detected ?? inferStack(slug)
}

/** Copy-paste commands for when Mushi cannot write the repo's Actions secrets itself. */
export function buildGuidedFallback(params: {
  owner: string
  repo: string
  ciVarTemplates: Array<{ name: string; ghKind: 'secret' | 'variable' }>
  projectId: string
  endpoint: string
}): { commands: string[]; envBlock: string } {
  const { owner, repo, ciVarTemplates, projectId, endpoint } = params
  const repoFlag = `--repo ${owner}/${repo}`
  const commands: string[] = []
  const envLines: string[] = []
  for (const v of ciVarTemplates) {
    if (v.ghKind === 'secret') {
      // The API key: the user supplies their project-scoped key; it is never printed here.
      commands.push(`gh secret set ${v.name} --body "<your-mushi-project-api-key>" ${repoFlag}`)
    } else {
      const val = v.name.toLowerCase().includes('endpoint') ? endpoint : projectId
      commands.push(`gh variable set ${v.name} --body "${val}" ${repoFlag}`)
    }
    envLines.push(`          ${v.name}: \${{ ${v.ghKind === 'secret' ? 'secrets' : 'vars'}.${v.name} }}`)
  }
  return { commands, envBlock: `        env:\n${envLines.join('\n')}` }
}

/** Origins and user agents a native (Capacitor / Android / iOS) build reports from. */
const NATIVE_ORIGIN_PATTERNS: ReadonlyArray<RegExp> = [
  /^capacitor:/i,
  /okhttp/i,
  /cfnetwork/i,
  /darwin.*like.*mac/i, // iOS simulator
  /testflight/i,
]

export interface KeyHeartbeat {
  last_seen_at: string | null
  last_seen_origin: string | null
  last_seen_user_agent: string | null
}

/** True when any key has reported from a native origin or user agent. */
export function nativeEverSeen(keys: ReadonlyArray<KeyHeartbeat>): boolean {
  return keys.some((r) => {
    const origin = r.last_seen_origin ?? ''
    const ua = r.last_seen_user_agent ?? ''
    return NATIVE_ORIGIN_PATTERNS.some((re) => re.test(origin) || re.test(ua))
  })
}

/** Most recent heartbeat across keys (rows may arrive in any order). */
export function lastHeartbeatAt(keys: ReadonlyArray<KeyHeartbeat>): string | null {
  let best: string | null = null
  let bestMs = -Infinity
  for (const k of keys) {
    if (!k.last_seen_at) continue
    const ms = Date.parse(k.last_seen_at)
    if (Number.isFinite(ms) && ms > bestMs) {
      best = k.last_seen_at
      bestMs = ms
    }
  }
  return best
}

export type SdkDiagnosticStatus = 'healthy' | 'ci-secret-missing' | 'native-never-seen' | 'banner-disabled' | 'unknown'

export interface SdkDiagnosticsResult {
  status: SdkDiagnosticStatus
  bannerEnabled: boolean
  launcherMode: string | null
  hasGithubToken: boolean
  repoUrl: string | null
  /** Names present in CI (secrets + variables combined). Null when no GitHub token. */
  presentVars: string[] | null
  /** Names required for the inferred stack. */
  requiredVars: string[]
  /** Names from requiredVars that are absent. Null when no GitHub token. */
  missingVars: string[] | null
  /** Last heartbeat across all active keys. */
  lastSeenAt: string | null
  /** True when any key has been seen from a native origin (capacitor:// / okhttp / CFNetwork). */
  nativeEverSeen: boolean
  stack: SdkStack
  /** `repo`: read from the repo's package.json. `slug`: guessed from the project slug (no token, or nothing readable). */
  stackSource?: 'repo' | 'slug'
  recommendedFix: string
}

/** Names from `required` absent from `present`; null when CI could not be read. */
export function missingCiVars(
  required: ReadonlyArray<{ name: string }>,
  present: ReadonlyArray<string> | null,
): string[] | null {
  if (present === null) return null
  const have = new Set(present)
  return required.filter((v) => !have.has(v.name)).map((v) => v.name)
}

/** The fused verdict: launcher config first, then CI presence, then heartbeat telemetry. */
export function sdkDiagnosticVerdict(input: {
  bannerEnabled: boolean
  launcherMode: string | null
  missingVars: string[] | null
  nativeEverSeen: boolean
  lastSeenAt: string | null
}): { status: SdkDiagnosticStatus; recommendedFix: string } {
  const { bannerEnabled, launcherMode, missingVars, lastSeenAt } = input
  if (!bannerEnabled || launcherMode === 'hidden' || launcherMode === 'manual') {
    return { status: 'banner-disabled', recommendedFix: 'Enable the banner in SDK Config → Launcher mode → Banner.' }
  }
  if (missingVars && missingVars.length > 0) {
    return {
      status: 'ci-secret-missing',
      recommendedFix:
        `The CI secrets/variables ${missingVars.join(', ')} are missing on the repo. ` +
        'Click "Sync CI secrets" to write them automatically, or copy the commands below.',
    }
  }
  if (!input.nativeEverSeen && lastSeenAt) {
    return {
      status: 'native-never-seen',
      recommendedFix:
        'The SDK has been seen from web/server origins but never from a native Capacitor ' +
        'build. Ensure the Mushi env vars are in the native build and that you have ' +
        'installed the app from the store after the last CI build.',
    }
  }
  if (missingVars !== null && missingVars.length === 0 && (input.nativeEverSeen || lastSeenAt)) {
    return { status: 'healthy', recommendedFix: 'All CI secrets present and SDK has reported from expected origins.' }
  }
  if (!lastSeenAt) {
    return {
      status: 'ci-secret-missing',
      recommendedFix:
        'SDK has never sent a heartbeat. Check that the Mushi env vars are set and the ' +
        'build:native step includes them.',
    }
  }
  return { status: 'unknown', recommendedFix: '' }
}
