/**
 * FILE: apps/admin/src/lib/nextBestAction.ts
 * PURPOSE: The single "what should I do next?" decision behind the
 *          <NextStep> banner and dashboard card (lib/useNextStep.ts).
 *
 * REGRESSION (2026-10-04 console audit): the strip decided from setup steps
 * only. On glot.it it said "IDLE — You're green across the loop" next to
 * failed fixes, and its "Watch the demo" CTA linked to "/". Real work now
 * comes first, in this order:
 *   1. unfixed critical or high reports;
 *   2. new reports nobody has looked at (user reports and Sentry imports);
 *   3. reports whose last auto-fix stopped;
 *   4. fix PRs waiting on review or merge;
 *   5. setup gaps;
 *   6. judge disagreements;
 *   7. only then "all clear".
 * Until the work counts have loaded, it never claims "all clear".
 * There is no demo route in the console, so no demo CTA is offered.
 */

import { stoppedTitle } from './countDefinitions'

export type NbaTone = 'plan' | 'do' | 'check' | 'act' | 'idle'

export interface NbaAction {
  /** PDCA-aligned tone so the strip colour matches the stage being worked. */
  tone: NbaTone
  /** Verb-led headline. */
  title: string
  /** One-sentence "why this matters right now". */
  why?: string
  /** Primary CTA — internal route or inline trigger (mutually exclusive). */
  cta:
    | { kind: 'link'; to: string; label: string }
    | { kind: 'inline-test-report'; label: string }
}

/** Current work counts for the active project, all counted per report (useNavCounts). */
export interface NbaWork {
  ready: boolean
  urgentOpenReports: number
  /** Reports still at status `new` (user reports and Sentry imports alike). */
  untriagedBacklog: number
  fixesFailed: number
  fixesRetryable: number
  prsOpen: number
  /** Classifier vs judge disagreements, 14-day window. */
  judgeDisagreements: number
}

export interface NbaSetup {
  hasAnyProject: boolean
  /** False while `/v1/admin/setup` has not answered yet; defaults to true. */
  resolved?: boolean
  activeProject: { report_count: number; fix_count: number } | null
  isStepIncomplete: (step: 'sdk_installed' | 'sentry_connected') => boolean
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export interface NbaOptions {
  /**
   * The setup checklist dock is open on screen. It already lists every setup
   * step, so the strip shows only real work (Plan 021: one "what next" voice
   * at a time) and stays quiet about setup.
   */
  setupGuideOpen?: boolean
}

export function computeNextAction(setup: NbaSetup, work: NbaWork, pathname: string, opts: NbaOptions = {}): NbaAction | null {
  // Pages with their own dominant first-action surface: don't double up.
  if (pathname === '/' || pathname.startsWith('/onboarding')) return null

  const project = setup.activeProject
  // "Create your first project" only on a resolved answer; while the setup
  // call is pending or failed, say nothing rather than something false (B1).
  if ((setup.resolved ?? true) && !setup.hasAnyProject) {
    return {
      tone: 'plan',
      title: 'Create your first project',
      why: 'A project is the inbox for user-felt bugs from one of your apps.',
      cta: { kind: 'link', to: '/onboarding', label: 'Open setup wizard' },
    }
  }
  if (!project) return null

  if (work.ready) {
    if (work.urgentOpenReports > 0) {
      const n = work.urgentOpenReports
      return {
        tone: 'plan',
        title: `${n} critical or high ${plural(n, 'report is', 'reports are')} still unfixed`,
        why: 'These hurt the most users. Read the diagnosis, then dispatch a fix or dismiss.',
        cta: { kind: 'link', to: '/reports?status=open', label: 'Open unfixed reports' },
      }
    }
    if (work.untriagedBacklog > 0) {
      const n = work.untriagedBacklog
      return {
        tone: 'plan',
        title: `${n} new ${plural(n, 'bug is', 'bugs are')} waiting for a look`,
        why: 'Read each diagnosis, then fix it, or close it as not a code bug.',
        cta: { kind: 'link', to: '/reports?status=new', label: 'Review new bugs' },
      }
    }
    if (work.fixesFailed > 0) {
      const n = work.fixesFailed
      return {
        tone: 'do',
        title: stoppedTitle(n),
        why:
          work.fixesRetryable > 0
            ? `${work.fixesRetryable} can be retried now. Open each to read why the last attempt stopped.`
            : 'Open each to read why the last attempt stopped and what to change first.',
        cta: { kind: 'link', to: '/fixes?tab=attempts&status=failed', label: 'See why' },
      }
    }
    if (work.prsOpen > 0) {
      const n = work.prsOpen
      return {
        tone: 'check',
        title: `${n} fix ${plural(n, 'PR is', 'PRs are')} waiting for your review`,
        why: 'Read the diff and merge, or close it — the report stays open until you do.',
        cta: { kind: 'link', to: '/fixes?tab=attempts&status=pr_open', label: 'Review PRs' },
      }
    }
  }

  if (opts.setupGuideOpen) return null

  if (setup.isStepIncomplete('sdk_installed')) {
    return {
      tone: 'plan',
      title: 'Install the Mushi widget in your app',
      why: 'Without the SDK, end-users have no way to flag bugs.',
      cta: { kind: 'link', to: '/onboarding', label: 'Open install steps' },
    }
  }

  if (project.report_count === 0) {
    return {
      tone: 'plan',
      title: 'Send a test report to see the loop run',
      why: 'A synthetic report flows through Plan → Do → Check → Act in ~30s.',
      cta: { kind: 'inline-test-report', label: 'Send test report' },
    }
  }

  if (project.fix_count === 0) {
    return {
      tone: 'do',
      title: `Dispatch a fix on your ${project.report_count} waiting ${plural(project.report_count, 'report', 'reports')}`,
      why: 'Mushi opens a draft PR with rationale. You review the diff, not the ticket.',
      cta: { kind: 'link', to: '/reports', label: 'Open Reports' },
    }
  }

  if (setup.isStepIncomplete('sentry_connected')) {
    return {
      tone: 'act',
      title: 'Wire merged fixes back to Sentry / Slack',
      why: 'Close the loop end-to-end so your team sees fixes where they already work.',
      cta: { kind: 'link', to: '/integrations/config', label: 'Set up routing' },
    }
  }

  // Not "all clear" until the work counts have actually been read.
  if (!work.ready) return null

  if (work.judgeDisagreements > 0) {
    const n = work.judgeDisagreements
    return {
      tone: 'check',
      title: `The judge disagreed with ${n} ${plural(n, 'diagnosis', 'diagnoses')}`,
      why: 'A second model graded these differently. Check them so the next diagnoses get better.',
      cta: { kind: 'link', to: '/judge?tab=evaluations&filter=disagreement', label: 'Check them' },
    }
  }

  return {
    tone: 'idle',
    title: 'All clear — no unfixed urgent reports, stopped fixes or open PRs.',
    why: 'New bugs and fix results will show up here.',
    cta: { kind: 'link', to: '/inbox?tab=activity', label: 'Open activity' },
  }
}
