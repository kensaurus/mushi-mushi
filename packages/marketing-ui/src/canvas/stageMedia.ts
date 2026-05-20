/**
 * Maps each Mushi loop stage to a live demo asset under /screenshots/.
 * Synced from docs/screenshots/ via scripts/sync-marketing-screenshots.mjs.
 */

import type { MushiStageId } from './data'

export interface StageMediaEntry {
  /** Filename inside the host's public /screenshots/ folder. */
  file: string
  /** When true, treat as an autoplaying GIF. */
  animated: boolean
  /** Dogfood SDK surface vs operator admin console — drives preview chrome copy. */
  surface: 'sdk' | 'admin'
  /** Human-readable preview rail copy (not the canvas node kicker). */
  previewEyebrow: string
  previewTitle: string
  chromeLabel: string
  alt: string
  caption: string
  lightboxTitle: string
  linkLabel: string
  /** Optional live demo URL — admin route or dogfood app. */
  demoHref?: string
}

export const stageMedia: Record<MushiStageId, StageMediaEntry> = {
  capture: {
    file: 'glotit-report-flow.gif',
    animated: true,
    surface: 'sdk',
    previewEyebrow: 'Step 1 · In your app',
    previewTitle: 'Report bug — full send flow',
    chromeLabel: 'SDK widget',
    alt: 'Report bug edge tab → Bug category → intent → description → submit → success stamp',
    caption: 'Edge tab opens the reporter: pick Bug, describe the issue, submit — screenshot and context attach automatically.',
    lightboxTitle: 'Capture — full SDK reporter flow',
    linkLabel: 'Try on glot.it',
    demoHref: 'https://kensaur.us/glot-it',
  },
  classify: {
    file: 'reports-demo.gif',
    animated: true,
    surface: 'admin',
    previewEyebrow: 'Step 2 · Admin console',
    previewTitle: 'Every report arrives triaged',
    chromeLabel: 'Reports queue',
    alt: 'Mushi admin Reports page — severity badges, taxonomy labels, and dispatch actions on each row',
    caption: 'Severity, taxonomy, repro steps, and a plain-English summary land in your queue.',
    lightboxTitle: 'Classify — Reports queue',
    linkLabel: 'Open Reports',
    demoHref: '/reports',
  },
  dispatch: {
    file: 'fixes-demo.gif',
    animated: true,
    surface: 'admin',
    previewEyebrow: 'Step 3 · Admin console',
    previewTitle: 'Agent opens a draft PR',
    chromeLabel: 'Fix orchestrator',
    alt: 'Fix orchestrator page — agent run stream, branch link, and diff preview',
    caption: 'The repair agent tries a fix and leaves you a branch, diff, and merge decision.',
    lightboxTitle: 'Dispatch — Fix orchestrator',
    linkLabel: 'Open Fixes',
    demoHref: '/fixes',
  },
  verify: {
    file: 'judge-demo.gif',
    animated: true,
    surface: 'admin',
    previewEyebrow: 'Step 4 · Admin console',
    previewTitle: 'Second model scores the patch',
    chromeLabel: 'Judge dashboard',
    alt: 'Judge dashboard — rubric score, pass/fail threshold, and reasoning for the proposed fix',
    caption: 'An independent judge reads the report and patch against your rubric before ship.',
    lightboxTitle: 'Verify — Judge score',
    linkLabel: 'Open Judge',
    demoHref: '/judge',
  },
  evolve: {
    file: 'graph-demo.gif',
    animated: true,
    surface: 'admin',
    previewEyebrow: 'Step 5 · Admin console',
    previewTitle: 'Patterns feed the next fix',
    chromeLabel: 'Knowledge graph',
    alt: 'Knowledge graph view — related reports cluster into recurring product friction patterns',
    caption: 'Related bugs connect in the graph and roll into the weekly friction report.',
    lightboxTitle: 'Evolve — Knowledge graph',
    linkLabel: 'Open Graph',
    demoHref: '/graph',
  },
}

/** Full-loop animated tour — shown in the canvas header as an overview clip. */
export const loopOverviewMedia: StageMediaEntry = {
  file: 'tour-pdca-loop.gif',
  animated: true,
  surface: 'admin',
  previewEyebrow: 'Full loop',
  previewTitle: 'Dashboard through graph in one pass',
  chromeLabel: 'Admin tour',
  alt: 'Animated admin console tour through dashboard, reports, fixes, judge, and graph',
  caption: 'Watch the full PDCA loop — triage, fix, judge, and graph in one pass.',
  lightboxTitle: 'Full loop tour',
  linkLabel: 'Open Dashboard',
  demoHref: '/dashboard',
}
