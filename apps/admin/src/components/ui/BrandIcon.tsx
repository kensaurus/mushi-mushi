/**
 * FILE: apps/admin/src/components/ui/BrandIcon.tsx
 * PURPOSE: The one way to show a third-party service's logo in the console:
 *          Settings, Integrations, Connect and Portfolio all use it, so the
 *          same service always looks the same.
 *
 *   <BrandIcon brand="anthropic" />                 → logo, accessible name "Anthropic"
 *   <BrandIcon brand="sentry.io" decorative />      → logo hidden from screen readers
 *                                                     (use next to visible name text)
 *   <BrandIcon brand="github" mono />               → monochrome, in the text colour
 *
 * `brand` accepts an id, a service name or a domain ("claude_code_agent",
 * "Microsoft Teams", "linear.app"). An unknown brand renders a neutral plug
 * glyph, never a broken image or a random letter.
 *
 * Marks are vendored in ./brandMarks.ts (licences noted there). Nothing is
 * fetched at runtime.
 */

import { BRAND_MARKS, type BrandId, type BrandMark } from './brandMarks'

const ALIASES: Record<string, BrandId> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  firecrawl: 'firecrawl',
  browserbase: 'browserbase',
  cursor: 'cursor',
  cursorcloud: 'cursor',
  cursorcloudagent: 'cursor',
  supabase: 'supabase',
  sentry: 'sentry',
  github: 'github',
  githubcloudagent: 'github',
  githubcopilot: 'github',
  slack: 'slack',
  linear: 'linear',
  jira: 'jira',
  atlassian: 'jira',
  discord: 'discord',
  microsoftteams: 'microsoftteams',
  msteams: 'microsoftteams',
  teams: 'microsoftteams',
  telegram: 'telegram',
  stripe: 'stripe',
  claude: 'claude',
  claudecode: 'claude',
  claudecodeagent: 'claude',
  claudedesktop: 'claude',
  anthropicmanaged: 'anthropic',
  vscode: 'vscode',
  vscodeinsiders: 'vscode',
  visualstudiocode: 'vscode',
  windsurf: 'windsurf',
  codeium: 'windsurf',
  zed: 'zed',
  zedindustries: 'zed',
}

const DOMAINS: Record<string, BrandId> = {
  'anthropic.com': 'anthropic',
  'console.anthropic.com': 'anthropic',
  'openai.com': 'openai',
  'platform.openai.com': 'openai',
  'openrouter.ai': 'openrouter',
  'firecrawl.dev': 'firecrawl',
  'browserbase.com': 'browserbase',
  'cursor.com': 'cursor',
  'cursor.sh': 'cursor',
  'supabase.com': 'supabase',
  'supabase.co': 'supabase',
  'sentry.io': 'sentry',
  'github.com': 'github',
  'slack.com': 'slack',
  'linear.app': 'linear',
  'atlassian.com': 'jira',
  'atlassian.net': 'jira',
  'discord.com': 'discord',
  'teams.microsoft.com': 'microsoftteams',
  'telegram.org': 'telegram',
  't.me': 'telegram',
  'stripe.com': 'stripe',
  'claude.ai': 'claude',
  'claude.com': 'claude',
  'code.visualstudio.com': 'vscode',
  'windsurf.com': 'windsurf',
  'codeium.com': 'windsurf',
  'zed.dev': 'zed',
}

/** Resolve an id, name or domain to a vendored mark; null when unknown. */
export function resolveBrand(input: string | null | undefined): BrandId | null {
  if (!input) return null
  const raw = input.trim().toLowerCase()
  if (!raw) return null
  const host = raw.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? ''
  if (DOMAINS[host]) return DOMAINS[host]
  // A subdomain of a known domain ("acme.atlassian.net", "o1.ingest.sentry.io").
  const parts = host.split('.')
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join('.')
    if (DOMAINS[parent]) return DOMAINS[parent]
  }
  const slug = raw.replace(/[^a-z0-9]/g, '')
  return ALIASES[slug] ?? null
}

export function brandTitle(input: string | null | undefined): string | null {
  const id = resolveBrand(input)
  return id ? BRAND_MARKS[id].title : null
}

interface BrandIconProps {
  /** Brand id, service name or domain. */
  brand: string
  /** Pixel size of the square icon. Default 16. */
  size?: number
  /** Hide from assistive tech when the name is already visible beside it. */
  decorative?: boolean
  /** Draw in the current text colour instead of the brand colour. */
  mono?: boolean
  /** Accessible name; defaults to the brand's own name. */
  label?: string
  className?: string
}

export function BrandIcon({
  brand,
  size = 16,
  decorative = false,
  mono = false,
  label,
  className = '',
}: BrandIconProps) {
  const id = resolveBrand(brand)
  const mark: BrandMark | null = id ? BRAND_MARKS[id] : null
  const name = label ?? mark?.title ?? brand
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': name } as const)

  if (!mark) {
    // Neutral plug: says "a connected service" without pretending to be a logo.
    return (
      <svg
        {...a11y}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`shrink-0 text-fg-muted ${className}`}
        data-brand="unknown"
      >
        <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0V5.5ZM8 11.5v2" />
      </svg>
    )
  }

  const fill = mono || mark.darkMark ? 'currentColor' : mark.hex
  return (
    <svg
      {...a11y}
      width={size}
      height={size}
      viewBox={mark.viewBox}
      fill={fill}
      className={`shrink-0 ${className}`}
      data-brand={id}
    >
      {mark.paths.map((p, i) => (
        <path key={i} d={p.d} fillRule={'evenOdd' in p && p.evenOdd ? 'evenodd' : undefined} />
      ))}
    </svg>
  )
}
