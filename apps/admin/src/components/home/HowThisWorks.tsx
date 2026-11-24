/**
 * FILE: apps/admin/src/components/home/HowThisWorks.tsx
 * PURPOSE: What Mushi does with a bug, in four plain steps, behind a small
 *          "How this works" disclosure. Open by default only on a new app
 *          that has no reports yet; everyone else opens it when they want it.
 *          Plain steps, no links: each step's page is already in the sidebar,
 *          and four links here made a new app's Home a page of buttons (ADR 0069).
 */

import { DisclosurePanel } from '../ui'

const STEPS = [
  { title: 'A bug comes in', body: 'A user reports it from your app, or Mushi Mushi spots it on your live site or in your monitoring.' },
  { title: 'Mushi Mushi explains it', body: 'You get a plain-English diagnosis: what broke, where, and how bad it is.' },
  { title: 'An AI agent drafts the fix', body: 'A coding agent opens a pull request; a second model reviews it before anything merges.' },
  { title: 'You ship it', body: 'You merge the fix, and Mushi Mushi checks the deploy went live.' },
] as const

export function HowThisWorks({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <div data-testid="home-how-this-works">
      <DisclosurePanel title="How this works" defaultOpen={defaultOpen}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="min-w-0">
              <p className="text-xs font-semibold text-fg">
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-subtle text-2xs text-brand-foreground">{i + 1}</span>
                {s.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </DisclosurePanel>
    </div>
  )
}
