/**
 * FILE: data.ts
 * PURPOSE: Static stage / edge / log / sample data for the MushiCanvas.
 *
 * The drawer-link `href` for each stage was previously computed via a Next.js-
 * specific `docsUrl()` helper (apps/cloud/lib/links.ts). To keep this package
 * router/framework-agnostic, the data now stores the *path suffix only*; the
 * components resolve the full URL through `useMarketing().urls.docs(suffix)`.
 */

export type MushiStageId = 'capture' | 'classify' | 'dispatch' | 'verify' | 'evolve'

/** Cognitive tone — see ../README for the colour/meaning map. */
export type StageTone = 'alert' | 'count' | 'link' | 'pass' | 'memory'

export interface MushiStage {
  id: MushiStageId
  index: number
  kicker: string
  title: string
  oneLiner: string
  drawerTitle: string
  drawerBody: string
  bullets: string[]
  stat: string
  tone: StageTone
  /** Docs path suffix — resolved via useMarketing().urls.docs(href) at render. */
  href: string
  position: { x: number; y: number }
}

export type StageHandleId =
  | 'top'
  | 'top-out'
  | 'right'
  | 'right-in'
  | 'bottom'
  | 'bottom-in'
  | 'left'
  | 'left-out'

export interface MushiEdge {
  id: string
  source: MushiStageId
  target: MushiStageId
  sourceHandle?: StageHandleId
  targetHandle?: StageHandleId
  label: string
}

export interface ReportSample {
  title: string
  path: string
  userNote: string
  browser: string
  severity: string
  taxonomy: string
  prNumber: string
  judgeScore: string
}

export interface StageNodeData extends Record<string, unknown> {
  stage: MushiStage
  focused: boolean
  selected: boolean
  onSelect: (stageId: MushiStageId) => void
}

export interface PaperEdgeData extends Record<string, unknown> {
  label: string
  active: boolean
  flowing: boolean
}

export const reportSample: ReportSample = {
  title: 'Checkout button disappears after coupon',
  path: '/glot-it/checkout',
  userNote: 'I added the spring coupon, then the pay button slipped under the bottom bar.',
  browser: 'Chrome 124 on Android',
  severity: 'High',
  taxonomy: 'UX regression',
  prNumber: '#42',
  judgeScore: '0.91',
}

export const stages: MushiStage[] = [
  {
    id: 'capture',
    index: 0,
    kicker: 'mushi.web · capture',
    title: 'User feels a bug. Mushi writes it down.',
    oneLiner: 'Shake to report — screenshot, intent, console, and network context in one send.',
    drawerTitle: 'No support ticket. No redirect. No memory loss.',
    drawerBody:
      'Mushi lives inside the app. The person who felt the bug reports it while the moment is still fresh — screenshot, what they were doing, and what broke, all bundled together.',
    bullets: ['Screenshot and page context travel together.', 'The widget stays out of the way until someone needs it.'],
    stat: '1 report',
    tone: 'count',
    href: '/quickstart',
    position: { x: 0, y: 80 },
  },
  {
    id: 'classify',
    index: 1,
    kicker: 'ai.triage · < 2 s',
    title: 'Plain read in under 2 seconds.',
    oneLiner: 'Severity, category, and a plain-English summary — the same labels your team already uses.',
    drawerTitle: '"It broke" becomes a useful row.',
    drawerBody:
      'A noisy user note becomes severity, component, likely cause, and a plain-English summary your team can act on.',
    bullets: ['Fast filter drops spam before the heavy model runs.', 'Engineers and support see the same summary — no translation layer.'],
    stat: 'High',
    tone: 'alert',
    href: '/concepts/classification',
    position: { x: 268, y: 80 },
  },
  {
    id: 'dispatch',
    index: 2,
    kicker: 'agent.fix · pr #42',
    title: 'Optional draft PR. You decide.',
    oneLiner: 'An agent can read your repo, write a diff, and open a draft PR — you merge, edit, or ignore.',
    drawerTitle: 'The agent does the first pass.',
    drawerBody:
      'Instead of a blank tracker row, you get a branch, a diff, and a clear review point. You keep the merge decision.',
    bullets: ['Branch, commit, and test notes grouped together.', 'Uses your own LLM key — your account, your bill.'],
    stat: 'PR #42',
    tone: 'link',
    href: '/concepts/fix-orchestrator',
    position: { x: 536, y: 80 },
  },
  {
    id: 'verify',
    index: 3,
    kicker: 'judge.llm · 0.91',
    title: 'QA checks the fix before you ship.',
    oneLiner: 'Automated replay of the user flow, plus a quality score before merge.',
    drawerTitle: 'Not every green diff is good enough.',
    drawerBody:
      'Automated tests replay the flow that triggered the report. A separate scorer reads the patch against a rubric — so the fix has to earn its confidence number.',
    bullets: ['Score makes risk visible before merge.', 'Thresholds configurable per project.'],
    stat: '0.91',
    tone: 'pass',
    href: '/concepts/judge-loop',
    position: { x: 536, y: 312 },
  },
  {
    id: 'evolve',
    index: 4,
    kicker: 'memory · lessons',
    title: 'Every fix teaches the next agent.',
    oneLiner: 'High-scoring fixes promote a lesson rule into .mushi/lessons.json — inherited by every future PR review.',
    drawerTitle: 'The loop feeds the next loop.',
    drawerBody:
      'When a fix scores above the promotion threshold, the pattern is saved as a lesson. The next reviewer — human or agent — sees it automatically so the same class of bug cannot recur silently.',
    bullets: ['Lessons are injected into PR context — human and AI reviewers both see them.', 'The user who triggered the fix gets credited in the changelog.'],
    stat: 'lessons++',
    tone: 'memory',
    href: '/concepts/evolution-loop',
    position: { x: 268, y: 312 },
  },
]

export const stageEdges: MushiEdge[] = [
  { id: 'capture-classify', source: 'capture', target: 'classify', sourceHandle: 'right', targetHandle: 'left', label: 'screenshot + note' },
  { id: 'classify-dispatch', source: 'classify', target: 'dispatch', sourceHandle: 'right', targetHandle: 'left', label: 'triage packet' },
  { id: 'dispatch-verify', source: 'dispatch', target: 'verify', sourceHandle: 'bottom', targetHandle: 'top', label: 'diff + tests' },
  { id: 'verify-evolve', source: 'verify', target: 'evolve', sourceHandle: 'left-out', targetHandle: 'right-in', label: 'judged & shipped' },
  { id: 'evolve-capture', source: 'evolve', target: 'capture', sourceHandle: 'left-out', targetHandle: 'bottom-in', label: 'memory feeds the next' },
]

export const logEvents = [
  { stageId: 'capture', text: 'Report captured from /glot-it/checkout', time: '00:01' },
  { stageId: 'classify', text: 'Classified as high-priority UX regression', time: '00:04' },
  { stageId: 'dispatch', text: 'Draft PR opened with guarded layout fix', time: '00:18' },
  { stageId: 'verify', text: 'Judge score passed project threshold', time: '00:31' },
  { stageId: 'evolve', text: 'Pattern added to weekly friction report', time: '00:45' },
] satisfies Array<{ stageId: MushiStageId; text: string; time: string }>
