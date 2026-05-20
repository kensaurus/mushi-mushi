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
  alt: string
  caption: string
  /** Optional live demo URL — admin route or dogfood app. */
  demoHref?: string
}

export const stageMedia: Record<MushiStageId, StageMediaEntry> = {
  capture: {
    file: 'glotit-report-flow.gif',
    animated: true,
    surface: 'sdk',
    alt: 'glot.it with the Mushi SDK bug-report button — open widget, describe the issue, submit',
    caption: 'SDK widget on glot.it — Report bug opens screenshot + context capture',
    demoHref: 'https://kensaur.us/glot-it',
  },
  classify: {
    file: 'reports-demo.gif',
    animated: true,
    surface: 'admin',
    alt: 'Mushi admin Reports queue — AI triage with severity stripes and dispatch actions',
    caption: 'Admin console /reports — severity, taxonomy, repro steps, and root-cause hint',
    demoHref: '/reports',
  },
  dispatch: {
    file: 'fixes-demo.gif',
    animated: true,
    surface: 'admin',
    alt: 'Fix orchestrator — agent runs stream live with draft PR links and diffs',
    caption: 'Admin console /fixes — agent opens a branch; you review the diff and merge',
    demoHref: '/fixes',
  },
  verify: {
    file: 'judge-demo.gif',
    animated: true,
    surface: 'admin',
    alt: 'Judge dashboard — independent LLM score against the project rubric',
    caption: 'Admin console /judge — second model scores the patch before it ships',
    demoHref: '/judge',
  },
  evolve: {
    file: 'graph-demo.gif',
    animated: true,
    surface: 'admin',
    alt: 'Knowledge graph — related bugs cluster into patterns the next fix inherits',
    caption: 'Admin console /graph — patterns roll into the knowledge graph and weekly report',
    demoHref: '/graph',
  },
}

/** Full-loop animated tour — shown in the canvas header as an overview clip. */
export const loopOverviewMedia: StageMediaEntry = {
  file: 'tour-pdca-loop.gif',
  animated: true,
  surface: 'admin',
  alt: 'Animated admin console tour — dashboard through reports, fixes, judge, and graph',
  caption: 'Full PDCA loop in one pass — dashboard → triage → fix → judge → graph',
  demoHref: '/dashboard',
}
