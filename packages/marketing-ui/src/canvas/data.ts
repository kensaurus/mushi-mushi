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
    kicker: 'mushi.web · shake',
    title: 'Your user shakes their phone.',
    oneLiner: 'A frustrated tap becomes a careful note: screenshot, console, network, and context.',
    drawerTitle: 'No support ticket needed.',
    drawerBody:
      'Mushi lives inside the app, so the person who felt the bug can send the useful details while the moment is still fresh.',
    bullets: ['Screenshot and page context travel together.', 'The widget stays out of the way until someone needs it.'],
    stat: '1 report',
    tone: 'count',
    href: '/quickstart',
    position: { x: 0, y: 0 },
  },
  {
    id: 'classify',
    index: 1,
    kicker: 'triage.llm · 28 ms',
    title: 'Mushi reads it like a careful editor.',
    oneLiner: 'Severity, repro steps, likely root cause, and plain-English labels arrive together.',
    drawerTitle: 'A messy note becomes a useful row.',
    drawerBody:
      'The classifier turns "it broke" into the same kind of signal your team already uses to decide what to fix first.',
    bullets: ['Two-stage triage keeps noisy reports calm.', 'Engineers and support see the same friendly summary.'],
    stat: 'High',
    tone: 'alert',
    href: '/concepts/classification',
    position: { x: 290, y: 0 },
  },
  {
    id: 'dispatch',
    index: 2,
    kicker: 'repair.agent · #42',
    title: 'A draft PR opens. You decide whether to merge.',
    oneLiner: 'Mushi tries the fix, shows the diff, and leaves the merge button with you.',
    drawerTitle: 'The agent does the first pass.',
    drawerBody:
      'Instead of another TODO in a tracker, the repair loop gives you a branch, a diff, and a clear place to review.',
    bullets: ['Branch, commit, and test notes are grouped together.', 'You keep the final approval step.'],
    stat: 'PR #42',
    tone: 'link',
    href: '/concepts/fix-orchestrator',
    position: { x: 580, y: 0 },
  },
  {
    id: 'verify',
    index: 3,
    kicker: 'judge.llm · 0.91',
    title: 'A second model checks the homework.',
    oneLiner: 'Independent scoring catches shaky fixes before they become a release note.',
    drawerTitle: 'Not every green diff is good enough.',
    drawerBody:
      'The judge reads the report, the patch, and the rubric separately so the fix has to earn its confidence.',
    bullets: ['A rubric score makes risk visible.', 'Thresholds stay configurable per project.'],
    stat: '0.91',
    tone: 'pass',
    // The verify stage describes the second-model judge ("A second model
    // checks the homework"), so it must link to the judge-loop concept,
    // not /concepts/classification (which the classify stage above
    // already owns). Both .mdx files live under apps/docs/content/concepts.
    href: '/concepts/judge-loop',
    position: { x: 580, y: 320 },
  },
  {
    id: 'evolve',
    index: 4,
    kicker: 'kg.weekly · trend',
    title: 'Every fix sharpens the next one.',
    oneLiner: 'A knowledge graph and weekly report turn bug repair into product memory.',
    drawerTitle: 'The next report starts smarter.',
    drawerBody:
      'Mushi remembers the pattern: where users stumble, which fixes worked, and what needs a product decision.',
    bullets: ['The weekly summary names the people who reported the bugs, not the codepaths that broke.', 'The knowledge graph keeps related bugs connected so the next report starts smarter.'],
    stat: '7 days',
    tone: 'memory',
    href: '/concepts/knowledge-graph',
    position: { x: 290, y: 320 },
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
