/**
 * FILE: apps/admin/src/components/tester/TesterVisuals.tsx
 * PURPOSE: Lightweight CSS visualizations for the Bounties portal — no chart
 *          library; uses design tokens + MiniInlineBar from the admin DS.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MiniInlineBar } from '../ui/metrics'
import { TESTER_PANEL } from './tester-ui'

const FLOW_STEPS = [
  { icon: '🔍', label: 'Browse', hint: 'Pick an app' },
  { icon: '🤝', label: 'Join', hint: 'One tap' },
  { icon: '🐛', label: 'Report', hint: 'Real bugs' },
  { icon: '🪙', label: 'Earn', hint: 'Get points' },
  { icon: '🎁', label: 'Redeem', hint: 'Pro or gift cards' },
] as const

export function TesterHowItWorksFlow({ className = '' }: { className?: string }) {
  return (
    <div className={`${TESTER_PANEL} p-4 ${className}`} role="list" aria-label="How Bounties works">
      <div className="grid grid-cols-5 gap-1 sm:gap-2">
        {FLOW_STEPS.map((step, i) => (
          <div key={step.label} className="relative flex flex-col items-center text-center" role="listitem">
            {i > 0 && (
              <span
                className="pointer-events-none absolute left-0 top-5 hidden h-px w-full -translate-x-1/2 bg-edge-subtle sm:block"
                aria-hidden
              />
            )}
            <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border border-brand/25 bg-brand-subtle text-lg">
              {step.icon}
            </span>
            <p className="mt-2 text-xs font-semibold text-fg">{step.label}</p>
            <p className="mt-0.5 text-2xs text-fg-muted">{step.hint}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TesterPointsEconomyStrip({ className = '' }: { className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${className}`}>
      <div className={`${TESTER_PANEL} p-4 text-center`}>
        <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">Gift cards</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">1,000</p>
        <p className="text-xs text-fg-muted">pts → $10</p>
        <div className="mt-3 flex justify-center">
          <MiniInlineBar value={100} max={130} widthClass="w-20" barClassName="bg-info" aria-label="1.0× face value" />
        </div>
      </div>
      <div className={`${TESTER_PANEL} border-brand/30 bg-brand-subtle/40 p-4 text-center`}>
        <p className="text-2xs font-medium uppercase tracking-wide text-brand">Mushi Pro</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">1,000</p>
        <p className="text-xs text-fg-muted">pts → $13 credit</p>
        <div className="mt-3 flex justify-center">
          <MiniInlineBar value={130} max={130} widthClass="w-20" barClassName="bg-brand" aria-label="1.3× premium" />
        </div>
        <p className="mt-1 text-2xs font-medium text-brand">1.3× bonus</p>
      </div>
      <div className={`${TESTER_PANEL} p-4 text-center`}>
        <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">Typical bug</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">500–2,500</p>
        <p className="text-xs text-fg-muted">pts per acceptance</p>
        <div className="mt-3 flex justify-center gap-1">
          {[40, 70, 100].map((v) => (
            <MiniInlineBar key={v} value={v} max={100} widthClass="w-6" barClassName="bg-ok" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  )
}

export function TesterGuideAccordion({
  id,
  icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  id: string
  icon: string
  title: string
  summary: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      id={id}
      className={`group scroll-mt-16 ${TESTER_PANEL} overflow-hidden`}
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <span className="text-xl leading-none" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{title}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{summary}</p>
        </div>
        <span className="shrink-0 text-2xs text-fg-faint group-open:rotate-180 motion-safe:transition-transform" aria-hidden>
          ▼
        </span>
      </summary>
      <div className="space-y-2 border-t border-edge-subtle px-4 pb-4 pt-2 text-sm leading-relaxed text-fg-secondary">
        {children}
      </div>
    </details>
  )
}

export function TesterGuideBullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-xs">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function TesterGuideLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
      {children}
      <span aria-hidden>→</span>
    </Link>
  )
}
