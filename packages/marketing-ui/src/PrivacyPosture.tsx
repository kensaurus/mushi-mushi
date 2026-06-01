'use client'

import { useMarketing } from './context'

interface PrivacyPill {
  label: string
  detail: string
  docPath: string
}

const PILLS: PrivacyPill[] = [
  {
    label: 'RLS isolated',
    detail: 'Every table is row-level-security scoped to your project. Your reports cannot cross tenant boundaries.',
    docPath: '/security/no-leakage-claim#your-data-doesnt-cross-project-boundaries',
  },
  {
    label: 'BYOK by default',
    detail: 'Supply your own Anthropic/OpenAI key and Mushi runs the loop against your account — not ours.',
    docPath: '/security/no-leakage-claim#byok--your-api-keys-run-against-your-account',
  },
  {
    label: 'Your code stays in your repo',
    detail: 'The fix agent reads a RAG index, never uploads your source files. Draft PRs go directly to your GitHub.',
    docPath: '/security/no-leakage-claim#your-code-stays-in-your-repo',
  },
]

export function PrivacyPosture() {
  const { Link, urls } = useMarketing()

  return (
    <ul className="flex flex-wrap justify-center gap-3 list-none p-0 m-0" aria-label="Privacy posture">
      {PILLS.map((pill) => (
        <li key={pill.label}>
          <Link
            href={urls.docs(pill.docPath)}
            className="group flex items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:border-[var(--mushi-ink)] hover:text-[var(--mushi-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
            aria-label={`${pill.label}: ${pill.detail}`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mushi-jade)]"
            />
            {pill.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
