/**
 * FILE: apps/admin/src/components/projects/projectNextSteps.ts
 * PURPOSE: Plain-language per-project verdict + prioritized action list for
 *          the Projects overview. Users asked "how is each project doing and
 *          what exactly do I do next?" — this derives both from data the page
 *          already loads (no new API calls). Pure functions, unit-tested.
 */

import type { Project } from './project-models'

export interface ProjectNextStep {
  id:
    | 'mint-key'
    | 'connect-sdk'
    | 'first-report'
    | 'upgrade-sdk'
    | 'work-backlog'
    | 'connect-repo'
  /** Verb-led, layman phrasing — what to do. */
  title: string
  /** One sentence on why it matters. */
  why: string
  /** Internal route for the CTA. */
  to: string
  ctaLabel: string
}

export type ProjectVerdictTone = 'ok' | 'attention' | 'inactive'

export interface ProjectPlainStatus {
  tone: ProjectVerdictTone
  /** One plain-English sentence: how this project is doing. */
  verdict: string
  steps: ProjectNextStep[]
}

const MAX_STEPS = 3

function hasEverConnected(p: Project): boolean {
  return p.api_keys.some((k) => k.is_active && k.last_seen_at)
}

function sdkUpgradeAvailable(p: Project): boolean {
  return Boolean(
    p.sdk_version && p.sdk_latest_version && p.sdk_version !== p.sdk_latest_version,
  )
}

/** Derive the ranked to-do list for one project. Earliest lifecycle gap wins. */
export function deriveProjectNextSteps(p: Project): ProjectNextStep[] {
  const steps: ProjectNextStep[] = []
  const connectTo = `/connect?project=${p.id}`

  if (p.active_key_count === 0) {
    steps.push({
      id: 'mint-key',
      title: 'Mint an API key',
      why: 'Your app has no way to send bugs to Mushi until it has a key.',
      to: connectTo,
      ctaLabel: 'Mint key',
    })
  } else if (!hasEverConnected(p)) {
    steps.push({
      id: 'connect-sdk',
      title: 'Connect your app',
      why: 'A key exists but no app has used it — add the SDK env vars to your app and redeploy.',
      to: connectTo,
      ctaLabel: 'Open install guide',
    })
  } else if (p.report_count === 0) {
    steps.push({
      id: 'first-report',
      title: 'Send a test bug',
      why: 'The SDK is connected but no report has arrived yet — a test proves the whole pipeline.',
      to: `/projects?project=${p.id}&tab=list`,
      ctaLabel: 'Send test report',
    })
  }

  if (sdkUpgradeAvailable(p)) {
    steps.push({
      id: 'upgrade-sdk',
      title: `Update the SDK (${p.sdk_version} → ${p.sdk_latest_version})`,
      why: 'One click opens a version-bump PR on your repo — you just review and merge.',
      to: connectTo,
      ctaLabel: 'Open Update center',
    })
  }

  if (p.pdca_bottleneck_label && (p.pdca_bottleneck_count ?? 0) > 0) {
    steps.push({
      id: 'work-backlog',
      title: `Clear what's stuck: ${p.pdca_bottleneck_label}`,
      why: 'This is the stage of the loop currently waiting on you.',
      to: `/inbox?project=${p.id}`,
      ctaLabel: 'Open inbox',
    })
  }

  if (!p.primary_repo?.repo_url && p.report_count > 0) {
    steps.push({
      id: 'connect-repo',
      title: 'Connect the GitHub repo',
      why: 'With a repo connected, Mushi can draft fix PRs instead of just describing bugs.',
      to: `/integrations/config?project=${p.id}`,
      ctaLabel: 'Connect repo',
    })
  }

  return steps.slice(0, MAX_STEPS)
}

/** One-sentence layman verdict + the steps, for a project card. */
export function deriveProjectPlainStatus(p: Project): ProjectPlainStatus {
  const steps = deriveProjectNextSteps(p)

  if (p.active_key_count === 0 || !hasEverConnected(p)) {
    return {
      tone: 'inactive',
      verdict: `${p.name} isn't connected yet — Mushi can't see this app until the SDK is installed.`,
      steps,
    }
  }
  if (p.report_count === 0) {
    return {
      tone: 'attention',
      verdict: `${p.name} is connected but hasn't received a single bug report yet.`,
      steps,
    }
  }
  if (steps.length > 0) {
    const thing = steps.length === 1 ? 'one thing' : `${steps.length} things`
    return {
      tone: 'attention',
      verdict: `${p.name} is up and running — ${thing} below would make it healthier.`,
      steps,
    }
  }
  return {
    tone: 'ok',
    verdict: `${p.name} is healthy — bugs flow in, nothing is waiting on you.`,
    steps,
  }
}
