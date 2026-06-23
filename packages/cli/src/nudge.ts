/**
 * `mushi nudge` — generate a Mushi.init() snippet tuned for the project's
 * release phase. Beta apps need very different nudge cadence than GA
 * production apps; this command picks sensible defaults and prints a
 * paste-ready block so devs don't have to hunt through SDK docs.
 *
 * The output deliberately favours conservative defaults (low session cap,
 * long cooldown) — over-prompting kills feedback quality faster than no
 * prompting at all. Users can dial up via flags.
 */

export type NudgePhase = 'alpha' | 'beta' | 'ga'

export interface NudgePreset {
  /** Maximum proactive prompts per session before we shut up. */
  maxProactivePerSession: number
  /** Hours to wait after a user dismisses a prompt. */
  dismissCooldownHours: number
  /** After this many consecutive dismissals, suppress permanently. */
  suppressAfterDismissals: number
  /** Continuous time on the same route before page-dwell fires. */
  pageDwellMinutes: number
  /** Delay after init before the first-session welcome fires. */
  firstSessionSeconds: number
  /** Enable the rage-click detector. */
  rageClick: boolean
  /** Enable the long-task detector (>5s task blocks the main thread). */
  longTask: boolean
  /** Enable the api-cascade detector (3+ consecutive 4xx/5xx in 10s). */
  apiCascade: boolean
  /** Enable the global error-boundary detector. */
  errorBoundary: boolean
  /** Whether to enable beta-mode UI affordances (changelog strip, badge). */
  betaMode: boolean
  /** Show "Feature request" as a first-class card on the category step. */
  featureRequestCard: boolean
}

const PRESETS: Record<NudgePhase, NudgePreset> = {
  // Alpha: noisy is OK because there are very few users and you need
  // signal yesterday. Show all triggers, short cooldowns.
  alpha: {
    maxProactivePerSession: 3,
    dismissCooldownHours: 6,
    suppressAfterDismissals: 5,
    pageDwellMinutes: 3,
    firstSessionSeconds: 30,
    rageClick: true,
    longTask: true,
    apiCascade: true,
    errorBoundary: true,
    betaMode: true,
    featureRequestCard: true,
  },
  // Beta: most apps spend the longest here. Conservative cadence so
  // we don't poison the well, but every trigger still on.
  beta: {
    maxProactivePerSession: 2,
    dismissCooldownHours: 24,
    suppressAfterDismissals: 3,
    pageDwellMinutes: 5,
    firstSessionSeconds: 45,
    rageClick: true,
    longTask: true,
    apiCascade: true,
    errorBoundary: true,
    betaMode: true,
    featureRequestCard: true,
  },
  // GA / production: only the technical signals (error boundary, rage
  // click). No page-dwell, no welcome — those are explicitly beta-only
  // patterns. Feature-request card still on because it's user-initiated.
  ga: {
    maxProactivePerSession: 1,
    dismissCooldownHours: 168,
    suppressAfterDismissals: 2,
    pageDwellMinutes: 0,
    firstSessionSeconds: 0,
    rageClick: true,
    longTask: false,
    apiCascade: true,
    errorBoundary: true,
    betaMode: false,
    featureRequestCard: true,
  },
}

export function getPreset(phase: NudgePhase): NudgePreset {
  return PRESETS[phase]
}

export interface NudgeSnippetOptions {
  phase: NudgePhase
  /** Override individual fields without choosing a new preset. */
  overrides?: Partial<NudgePreset>
}

/**
 * Render a paste-ready `Mushi.init({...})` snippet. We return strings (not
 * JSON) so we can preserve TypeScript expression form (`true`, numeric
 * arithmetic, comments). The dev pastes this into their bootstrap file.
 */
export function renderNudgeSnippet(opts: NudgeSnippetOptions): string {
  const p = { ...PRESETS[opts.phase], ...opts.overrides }
  const dwellMs = p.pageDwellMinutes > 0 ? `${p.pageDwellMinutes} * 60 * 1000` : null
  const firstMs = p.firstSessionSeconds > 0 ? `${p.firstSessionSeconds} * 1000` : null

  const proactiveLines: string[] = []
  if (p.rageClick) proactiveLines.push(`    rageClick: true,`)
  if (p.longTask) proactiveLines.push(`    longTask: true,`)
  if (p.apiCascade) proactiveLines.push(`    apiCascade: true,`)
  if (p.errorBoundary) proactiveLines.push(`    errorBoundary: true,`)
  if (dwellMs) proactiveLines.push(`    pageDwell: { thresholdMs: ${dwellMs} }, // ${p.pageDwellMinutes}min on the same route`)
  if (firstMs) proactiveLines.push(`    firstSession: { delayMs: ${firstMs} }, // welcome new users after ${p.firstSessionSeconds}s`)
  proactiveLines.push(`    cooldown: {`)
  proactiveLines.push(`      maxProactivePerSession: ${p.maxProactivePerSession},`)
  proactiveLines.push(`      dismissCooldownHours: ${p.dismissCooldownHours},`)
  proactiveLines.push(`      suppressAfterDismissals: ${p.suppressAfterDismissals},`)
  proactiveLines.push(`    },`)

  const widgetLines: string[] = []
  if (p.featureRequestCard) widgetLines.push(`    featureRequestCard: true,`)
  if (p.betaMode) {
    widgetLines.push(`    betaMode: {`)
    widgetLines.push(`      enabled: true,`)
    widgetLines.push(`      label: 'BETA',`)
    widgetLines.push(`      // changelogItems: [{ version: '1.0.0', date: '${new Date().toISOString().slice(0, 10)}', items: ['Fixed login timeout on slow networks'] }],`)
    widgetLines.push(`    },`)
  }

  return [
    `// Generated by \`mushi nudge --phase ${opts.phase}\``,
    `// Phase: ${opts.phase} — tune via --max, --cooldown, --dwell, --welcome.`,
    `Mushi.init({`,
    `  projectId: process.env.MUSHI_PROJECT_ID!,`,
    `  apiKey: process.env.MUSHI_API_KEY!,`,
    `  proactive: {`,
    ...proactiveLines,
    `  },`,
    ...(widgetLines.length ? [`  widget: {`, ...widgetLines, `  },`] : []),
    `})`,
    ``,
  ].join('\n')
}

export function renderNudgeExplainer(phase: NudgePhase): string {
  const p = PRESETS[phase]
  const lines: string[] = []
  lines.push(``)
  lines.push(`Nudge preset for "${phase}" phase:`)
  lines.push(`  - max ${p.maxProactivePerSession} proactive prompts per session`)
  lines.push(`  - ${p.dismissCooldownHours}h cooldown after a dismissal`)
  lines.push(`  - suppress permanently after ${p.suppressAfterDismissals} consecutive dismissals`)
  if (p.pageDwellMinutes > 0) lines.push(`  - fire page-dwell trigger after ${p.pageDwellMinutes} continuous minutes on a route`)
  if (p.firstSessionSeconds > 0) lines.push(`  - welcome new users with a button pulse ${p.firstSessionSeconds}s after init`)
  lines.push(`  - signals enabled: ${[
    p.rageClick && 'rage-click',
    p.longTask && 'long-task',
    p.apiCascade && 'api-cascade',
    p.errorBoundary && 'error-boundary',
  ].filter(Boolean).join(', ')}`)
  lines.push(`  - feature-request card: ${p.featureRequestCard ? 'shown' : 'hidden'}`)
  lines.push(`  - beta-mode UI: ${p.betaMode ? 'on' : 'off'}`)
  lines.push(``)
  return lines.join('\n')
}
