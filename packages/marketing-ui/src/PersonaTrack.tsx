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

function PersonaLink({
  card,
  featured,
}: {
  card: PersonaCard
  featured?: boolean
}) {
  const { Link, urls } = useMarketing()
  return (
    <Link
      href={card.docsPath ? urls.docs(card.docsPath) : card.slug}
      className={
        featured
          ? 'group flex h-full flex-col gap-3 rounded-2xl border border-[color-mix(in_oklch,var(--mushi-ink)_35%,var(--mushi-rule))] bg-[var(--mushi-paper)] p-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8 transition-[border-color,opacity] hover:border-[var(--mushi-vermillion)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]'
          : 'group flex h-full flex-col gap-2 rounded-xl border border-[var(--mushi-rule)] bg-transparent px-4 py-4 transition-[border-color,opacity] hover:border-[color-mix(in_oklch,var(--mushi-ink)_45%,var(--mushi-rule))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]'
      }
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--mushi-vermillion)]">
          {card.eyebrow}
        </p>
        <p
          className={
            featured
              ? 'mt-2 font-serif text-[1.25rem] leading-[1.3] tracking-[-0.02em] text-[var(--mushi-ink)] sm:text-[1.4rem]'
              : 'mt-1.5 font-serif text-[1rem] leading-[1.35] tracking-[-0.02em] text-[var(--mushi-ink)]'
          }
        >
          {card.painPoint}
        </p>
        {featured ? (
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--mushi-ink-muted)]">
            {card.loopSlice}
          </p>
        ) : null}
      </div>
      <p
        className={
          featured
            ? 'mt-4 shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink)] sm:mt-0'
            : 'mt-auto pt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink)] opacity-70 transition-opacity group-hover:opacity-100'
        }
      >
        {card.cta}
      </p>
    </Link>
  )
}

export function PersonaTrack() {
  const [featured, ...rest] = PERSONA_CARDS

  return (
    <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
      <li className="sm:col-span-2">
        <PersonaLink card={featured} featured />
      </li>
      {rest.map((card) => (
        <li key={card.id}>
          <PersonaLink card={card} />
        </li>
      ))}
    </ul>
  )
}
