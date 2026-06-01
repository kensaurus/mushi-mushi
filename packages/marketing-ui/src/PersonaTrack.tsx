'use client'

import { useMarketing } from './context'

/**
 * PersonaTrack — three short sub-page cards for the three Mushi personas.
 *
 * Usage: embed after the Hero section to give each persona a deeper entry
 * point. Route `/for-vibe-coders`, `/for-ai-teams`, `/for-pms` link to full
 * persona pages; this component renders teaser cards that push the visitor
 * there. The host app is responsible for defining those routes.
 */

export interface PersonaCard {
  id: string
  slug: string
  eyebrow: string
  painPoint: string
  loopSlice: string
  cta: string
  docsPath?: string
}

const PERSONA_CARDS: PersonaCard[] = [
  {
    id: 'vibe',
    slug: '/for-vibe-coders',
    eyebrow: 'For vibe coders',
    painPoint: 'You ship fast. The choke point is figuring out what users actually hit.',
    loopSlice: 'Mushi captures the shake-to-report, AI opens the PR. You merge or skip. The loop doesn\'t wait for QA.',
    cta: 'See the vibe-coder loop →',
    docsPath: '/guides/vibe-coder',
  },
  {
    id: 'team',
    slug: '/for-ai-teams',
    eyebrow: 'For AI-native teams',
    painPoint: 'Your agents write the code. But they don\'t know which bugs to fix next.',
    loopSlice: 'Connect Mushi MCP to Cursor or Claude Code. Agents read the lesson library before touching a file.',
    cta: 'Set up agent loop →',
    docsPath: '/guides/ai-team',
  },
  {
    id: 'pm',
    slug: '/for-pms',
    eyebrow: 'For PMs and founders',
    painPoint: 'User feedback reaches you through support tickets and Slack DMs — days late, context lost.',
    loopSlice: 'Bug and feature signal arrives direct from the app, triaged by AI, with a draft fix already waiting.',
    cta: 'See the PM signal loop →',
    docsPath: '/guides/pm',
  },
]

export function PersonaTrack() {
  const { Link, urls } = useMarketing()

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {PERSONA_CARDS.map((card) => (
        <Link
          key={card.id}
          href={card.docsPath ? urls.docs(card.docsPath) : card.slug}
          className="group flex flex-col gap-3 rounded-2xl border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] p-5 transition hover:border-[color-mix(in_oklch,var(--mushi-ink)_45%,var(--mushi-rule))] hover:shadow-[0_8px_32px_-16px_rgba(14,13,11,0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--mushi-vermillion)]">
            {card.eyebrow}
          </p>
          <p className="font-serif text-[1.05rem] leading-[1.3] tracking-[-0.02em] text-[var(--mushi-ink)]">
            {card.painPoint}
          </p>
          <p className="text-sm leading-6 text-[var(--mushi-ink-muted)]">
            {card.loopSlice}
          </p>
          <p className="mt-auto font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink)] opacity-60 transition group-hover:opacity-100">
            {card.cta}
          </p>
        </Link>
      ))}
    </div>
  )
}
