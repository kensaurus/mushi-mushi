'use client'

import { useMarketing } from './context'

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
    loopSlice: 'User shakes to report. Mushi explains what broke and hands Cursor a fix prompt. You merge or skip.',
    cta: 'See the vibe-coder loop →',
    docsPath: '/quickstart/incident-loop',
  },
  {
    id: 'team',
    slug: '/for-ai-teams',
    eyebrow: 'For AI-native teams',
    painPoint: 'Your agents write the code. But they do not know which bugs to fix next.',
    loopSlice: 'Connect Mushi to Cursor or Claude Code. Agents read past fixes before touching a file.',
    cta: 'Set up agent loop →',
    docsPath: '/integrations/cursor',
  },
  {
    id: 'pm',
    slug: '/for-pms',
    eyebrow: 'For PMs and founders',
    painPoint: 'User feedback reaches you through support tickets and Slack DMs — days late, context lost.',
    loopSlice: 'Bug signal arrives from the app with a plain-English read — and an optional draft fix waiting.',
    cta: 'See the PM signal loop →',
    docsPath: '/admin/reports',
  },
]

export function PersonaTrack() {
  const { Link, urls } = useMarketing()

  return (
    <ul className="grid gap-4 sm:grid-cols-3 list-none p-0 m-0">
      {PERSONA_CARDS.map((card) => (
        <li key={card.id}>
          <Link
            href={card.docsPath ? urls.docs(card.docsPath) : card.slug}
            className="group flex h-full flex-col gap-3 rounded-2xl border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] p-5 transition hover:border-[color-mix(in_oklch,var(--mushi-ink)_45%,var(--mushi-rule))] hover:shadow-[0_8px_32px_-16px_rgba(14,13,11,0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
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
        </li>
      ))}
    </ul>
  )
}
