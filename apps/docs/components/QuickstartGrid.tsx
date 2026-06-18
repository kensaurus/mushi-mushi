/**
 * FILE: apps/docs/components/QuickstartGrid.tsx
 * PURPOSE: Replaces the default Nextra <Cards> block for the "Try it in 60
 *   seconds" section on the landing page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nextra's <Cards.Card> uses `auto-fit minmax(16rem, 1fr)` which produces an
 * uneven 3+1 distribution on a ~750 px content column — three cards collapse
 * to one row and the fourth sits alone on a second row, mismatching heights
 * and making the section look like a template dump.
 *
 * This component:
 *   - Forces a stable 2×2 grid (1 column on narrow) regardless of content width.
 *   - Shows the npm/pod install command in a real code pill so developers know
 *     the integration cost before clicking — reducing decision friction.
 *   - Uses the existing editorial card language (paper bg, rule border, vermillion
 *     leading rail on hover) from globals.css `.docs-quickstart-card`.
 *   - Marks up each card as an <a> so keyboard / screen-reader users get
 *     "link to React quickstart" semantics, not just a presentational block.
 */
'use client'

interface PlatformCard {
  title: string
  /** Unicode glyph or single emoji. Keep visual weight similar across cards. */
  icon: string
  href: string
  /** The one-line install command shown verbatim in the code pill. */
  cmd: string
  /** Short description — 1–2 sentences max. */
  desc: string
  /** Optional badge (e.g. "Native", "AI-native"). */
  badge?: string
}

const PLATFORMS: readonly PlatformCard[] = [
  {
    title: 'Incident loop',
    icon: '⚡',
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi',
    desc: 'Broken prod → plain-English diagnosis → paste-ready fix prompt in Cursor.',
    badge: 'Start here',
  },
  {
    title: 'MCP server',
    icon: '◉',
    href: '/quickstart/mcp',
    cmd: 'npx mushi-mushi setup --ide cursor',
    desc: 'Triage and fix briefs from Claude, Cursor, or Codex — no second LLM key.',
    badge: 'AI-native',
  },
  {
    title: 'React',
    icon: '⚛',
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
    desc: 'Wizard installs the SDK, writes env vars, optional test report.',
  },
  {
    title: 'iOS · Android · Flutter',
    icon: '◈',
    href: '/quickstart/mobile',
    cmd: "pod 'MushiMushi'",
    desc: 'Native shake, offline queue, and a Sentry bridge already wired up.',
    badge: 'Native',
  },
]

export function QuickstartGrid() {
  return (
    <div className="docs-quickstart-grid not-prose" role="list" aria-label="Platform quickstarts">
      {PLATFORMS.map((p) => (
        <a
          key={p.title}
          href={p.href}
          className="docs-quickstart-card"
          role="listitem"
          aria-label={`${p.title} quickstart`}
        >
          <div className="docs-quickstart-card__header">
            <span className="docs-quickstart-card__icon" aria-hidden="true">
              {p.icon}
            </span>
            <span className="docs-quickstart-card__title">{p.title}</span>
            {p.badge ? (
              <span className="docs-quickstart-card__badge">{p.badge}</span>
            ) : null}
          </div>
          <code className="docs-quickstart-card__cmd">{p.cmd}</code>
          <p className="docs-quickstart-card__desc">{p.desc}</p>
          <span className="docs-quickstart-card__cta" aria-hidden="true">
            Quickstart →
          </span>
        </a>
      ))}
    </div>
  )
}
