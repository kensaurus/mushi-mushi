/**
 * FILE: apps/admin/src/components/QuickstartMegaCta.tsx
 * PURPOSE: The single dominant CTA pinned above page content in Quickstart
 *          mode (Wave N). Replaces the more verbose <NextBestAction> strip.
 *
 *          Computes the next thing the user should do across the whole loop
 *          and renders ONE big button:
 *            • No project        → "Set up your project →"
 *            • No reports        → "Send a test bug to see the loop run →"
 *            • Reports waiting   → "Resolve next bug → <summary>"
 *            • All resolved      → "🎉 You're caught up — open Mushi"
 *
 *          One source of truth: change the rule order below and the
 *          Quickstart sidebar's primary action updates everywhere.
 */

import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAdminMode } from '../lib/mode'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from './ProjectSwitcher'
import { usePageData } from '../lib/usePageData'

interface NextReport {
  id: string
  summary: string | null
  description: string | null
  severity: string | null
  component: string | null
}

const SEVERITY_TONE: Record<string, { dot: string; label: string }> = {
  critical: { dot: 'bg-danger', label: 'Critical' },
  high: { dot: 'bg-warn', label: 'High' },
  medium: { dot: 'bg-info', label: 'Medium' },
  low: { dot: 'bg-fg-faint', label: 'Low' },
}

const SHOW_ON_PATHS = new Set(['/', '/reports', '/fixes'])

export function QuickstartMegaCta() {
  const { isQuickstart } = useAdminMode()
  const { pathname } = useLocation()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)

  // Always call hooks unconditionally — early returns happen below.
  const reportsQuery = usePageData<{ reports: NextReport[]; total: number }>(
    isQuickstart && setup.activeProject?.report_count
      ? '/v1/admin/reports?status=new&sort=severity&dir=desc&limit=1'
      : null,
  )

  const cta = useMemo(() => {
    if (!setup.hasAnyProject) {
      return {
        title: 'Set up your first project',
        sub: 'Takes about 10 minutes — copy a snippet, paste your URL, send a test bug.',
        button: 'Open setup',
        to: '/onboarding',
        tone: 'plan' as const,
      }
    }
    const project = setup.activeProject
    if (!project) return null

    if (setup.isStepIncomplete('sdk_installed')) {
      return {
        title: 'Install the Mushi widget in your app',
        sub: 'Without the widget, end-users have no way to flag bugs.',
        button: 'Open install steps',
        to: '/onboarding',
        tone: 'plan' as const,
      }
    }

    if (project.report_count === 0) {
      return {
        title: 'Send a test bug to see the loop run',
        sub: 'A synthetic report flows from your app to a draft PR in about 30 seconds.',
        button: 'Open setup',
        to: '/onboarding',
        tone: 'plan' as const,
      }
    }

    const next = reportsQuery.data?.reports?.[0]
    if (next) {
      const summary =
        next.summary?.trim() ||
        next.description?.trim().slice(0, 80) ||
        `Report ${next.id.slice(0, 8)}…`
      return {
        title: 'Resolve the next bug',
        sub: summary,
        button: 'Open bug',
        to: `/reports/${next.id}`,
        tone: 'do' as const,
        severity: next.severity ?? 'medium',
        component: next.component,
      }
    }

    return {
      title: "You're caught up",
      sub: 'No new bugs waiting. Mushi will surface the next one here as soon as it lands.',
      button: 'Open inbox',
      to: '/reports',
      tone: 'idle' as const,
    }
  }, [setup, reportsQuery.data])

  if (!isQuickstart) return null
  if (pathname.startsWith('/login') || pathname.startsWith('/recovery')) return null
  if (pathname.startsWith('/onboarding')) return null
  if (pathname.startsWith('/reports/')) return null
  if (!SHOW_ON_PATHS.has(pathname)) return null
  if (setup.loading) return null
  if (!cta) return null

  const sevTone = 'severity' in cta && cta.severity
    ? SEVERITY_TONE[cta.severity] ?? SEVERITY_TONE.medium
    : null

  const ringTone =
    cta.tone === 'do'
      ? 'border-brand/50 bg-gradient-to-br from-brand/15 via-brand/5 to-transparent'
      : cta.tone === 'plan'
      ? 'border-info/40 bg-gradient-to-br from-info/15 via-info/5 to-transparent'
      : 'border-edge bg-surface-raised/40'

  const buttonTone =
    cta.tone === 'idle'
      ? 'bg-surface-raised text-fg border border-edge hover:bg-surface-overlay'
      : 'bg-brand text-brand-fg hover:bg-brand-hover'

  return (
    <aside
      role="complementary"
      aria-label="Quickstart primary action"
      data-tour-id="quickstart-mega-cta"
      className={`mb-4 -mt-1 flex items-center gap-4 rounded-xl border ${ringTone} px-4 py-3.5 motion-safe:animate-mushi-fade-in`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {sevTone && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-fg-secondary border border-edge bg-surface-root/60`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${sevTone.dot}`} aria-hidden="true" />
              {sevTone.label}
            </span>
          )}
          {'component' in cta && cta.component && (
            <span className="text-3xs text-fg-faint font-mono truncate max-w-[18rem]" title={cta.component}>
              {cta.component}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold text-fg leading-tight truncate">
          {cta.title}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted leading-snug truncate">{cta.sub}</p>
      </div>
      <Link
        to={cta.to}
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium motion-safe:transition-colors motion-safe:active:scale-[0.97] motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${buttonTone}`}
      >
        {cta.button} <span aria-hidden="true">→</span>
      </Link>
    </aside>
  )
}
