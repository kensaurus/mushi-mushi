/**
 * FILE: apps/admin/src/components/report-detail/ReportDiagnosisGraph.tsx
 * PURPOSE: "How Mushi reached this diagnosis" on the report page: evidence,
 *          signals, diagnosis, checks and fix as five lanes with the links
 *          between them drawn, a numbered path to the verdict, and a side
 *          panel with the reasoning and the field each claim came from.
 *          Claims under 80% confidence carry a "check this" mark so a person
 *          knows where to look first.
 *
 *          Data comes from lib/reportDiagnosisGraph.ts (pure, tested). The
 *          lanes are plain grid columns of <button>s and the links are one
 *          SVG overlay measured from the buttons, so text wraps naturally,
 *          every node is reachable by keyboard, and below the lg breakpoint
 *          the lanes stack and the links are hidden.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge, Card } from '../ui'
import { IconGraph } from '../icons'
import { CHIP_TONE } from '../../lib/chipTone'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { buildDiagnosisGraph, initialDiagnosisSelection } from '../../lib/reportDiagnosisGraph'
import { DIAGNOSIS_LANES, type DiagnosisGraph, type DiagnosisLane, type DiagnosisNode } from '../../lib/reportDiagnosisModel'
import type { ReportDetail } from './types'

// Checks are green (verification) and Fix is the brand colour (action);
// red for Checks read as "error" on the first localhost pass.
const LANE_STRIPE: Record<DiagnosisLane, string> = {
  evidence: 'border-l-edge',
  signal: 'border-l-info',
  diagnosis: 'border-l-accent',
  check: 'border-l-ok',
  fix: 'border-l-brand',
}

const LANE_DOT: Record<DiagnosisLane, string> = {
  evidence: 'bg-edge',
  signal: 'bg-info',
  diagnosis: 'bg-accent',
  check: 'bg-ok',
  fix: 'bg-brand',
}

const VERDICT_TONE: Record<DiagnosisGraph['verdict']['tone'], string> = {
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
  info: CHIP_TONE.infoSubtle,
}

function stateChip(node: DiagnosisNode): { label: string; tone: string } | null {
  if (node.state === 'failed') return { label: 'failed', tone: CHIP_TONE.dangerSubtle }
  if (node.needsLook) return { label: node.confidence != null ? `check · ${Math.round(node.confidence * 100)}%` : 'check this', tone: CHIP_TONE.warnSubtle }
  if (node.state === 'pending') return { label: 'in progress', tone: CHIP_TONE.infoSubtle }
  if (node.state === 'open') return { label: 'your move', tone: CHIP_TONE.infoSubtle }
  if (node.state === 'done') return { label: 'done', tone: CHIP_TONE.okSubtle }
  if (node.confidence != null) return { label: `${Math.round(node.confidence * 100)}%`, tone: CHIP_TONE.okSubtle }
  return null
}

function StateChip({ node }: { node: DiagnosisNode }) {
  const chip = stateChip(node)
  if (!chip) return null
  return <Badge className={`${chip.tone} shrink-0 font-mono text-3xs`}>{chip.label}</Badge>
}

interface EdgePath {
  key: string
  d: string
  from: string
  to: string
  onPath: boolean
}

/** Measures the node buttons and draws one bezier per edge, right side → left side. */
function useEdgePaths(
  container: React.RefObject<HTMLDivElement | null>,
  graph: DiagnosisGraph,
  enabled: boolean,
): EdgePath[] {
  const [paths, setPaths] = useState<EdgePath[]>([])
  useLayoutEffect(() => {
    const el = container.current
    if (!el || !enabled) {
      setPaths([])
      return
    }
    const onPath = new Set(graph.path.slice(1).map((id, i) => `${graph.path[i]}>${id}`))
    const draw = () => {
      const box = el.getBoundingClientRect()
      const next: EdgePath[] = []
      for (const [from, to] of graph.edges) {
        const a = el.querySelector<HTMLElement>(`[data-node-id="${from}"]`)?.getBoundingClientRect()
        const b = el.querySelector<HTMLElement>(`[data-node-id="${to}"]`)?.getBoundingClientRect()
        if (!a || !b || a.width === 0 || b.width === 0) continue
        const x1 = a.right - box.left
        const y1 = a.top + a.height / 2 - box.top
        const x2 = b.left - box.left
        const y2 = b.top + b.height / 2 - box.top
        // Same-lane links (cause → component) curve out to the right and back.
        const sameLane = Math.abs(x2 - (a.left - box.left)) < 4
        const d = sameLane
          ? `M${x1},${y1} C${x1 + 28},${y1} ${x1 + 28},${y2} ${x1},${y2}`
          : `M${x1},${y1} C${x1 + Math.max(16, (x2 - x1) / 2)},${y1} ${x2 - Math.max(16, (x2 - x1) / 2)},${y2} ${x2},${y2}`
        next.push({ key: `${from}>${to}`, d, from, to, onPath: onPath.has(`${from}>${to}`) })
      }
      setPaths(next)
    }
    draw()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [container, graph, enabled])
  return paths
}

function NodeButton({
  node,
  selected,
  onPath,
  onSelect,
}: {
  node: DiagnosisNode
  selected: boolean
  onPath: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-node-id={node.id}
      aria-pressed={selected}
      onClick={() => onSelect(node.id)}
      className={[
        'relative z-10 flex w-full flex-col gap-1 rounded-md border border-l-4 bg-surface-raised px-2.5 py-2 text-left',
        'motion-safe:transition-[box-shadow,border-color] hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        LANE_STRIPE[node.lane],
        selected ? 'border-brand ring-2 ring-brand/40' : onPath ? 'border-info/40' : 'border-edge-subtle',
      ].join(' ')}
    >
      <span className="line-clamp-3 text-xs font-medium leading-snug text-fg" title={node.title}>
        {node.title}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <StateChip node={node} />
        <span className="min-w-0 truncate font-mono text-3xs text-fg-muted" title={node.detail}>
          {node.detail}
        </span>
      </span>
    </button>
  )
}

/** Same overflow check as CodePanel: a box that can scroll, not one merely styled overflow:auto. */
function contentOverflows(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

function WhyMushiBelieves({ why }: { why: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOverflows(contentOverflows(el))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [why])

  return (
    <div
      ref={ref}
      tabIndex={overflows ? 0 : undefined}
      role={overflows ? 'region' : undefined}
      aria-label={overflows ? 'Why Mushi believes this' : undefined}
      className="max-h-64 overflow-y-auto rounded-md border border-edge-subtle bg-surface-overlay/40 px-2.5 py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
    >
      <p className="whitespace-pre-line text-xs leading-relaxed text-fg-secondary">{why}</p>
    </div>
  )
}

function NodePanel({
  node,
  graph,
  onSelect,
}: {
  node: DiagnosisNode | null
  graph: DiagnosisGraph
  onSelect: (id: string) => void
}) {
  if (!node) return <p className="text-xs text-fg-muted">Pick a node to see why Mushi believes it.</p>
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const from = graph.edges.filter(([, b]) => b === node.id).map(([a]) => byId.get(a)!)
  const to = graph.edges.filter(([a]) => a === node.id).map(([, b]) => byId.get(b)!)
  const lane = DIAGNOSIS_LANES.find((l) => l.id === node.lane)
  const linkList = (label: string, list: DiagnosisNode[]) =>
    list.length > 0 ? (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xs uppercase tracking-wider text-fg-faint">{label}</span>
        {list.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            className="text-left text-2xs text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            {n.title.split(':')[0]}
          </button>
        ))}
      </div>
    ) : null
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider text-fg-faint">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${LANE_DOT[node.lane]}`} />
        {lane?.label}
      </div>
      <h4 className="text-sm font-semibold leading-snug text-fg">{node.title}</h4>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
        <StateChip node={node} />
        <span className="font-mono">{node.detail}</span>
      </div>
      {/* The paragraph stays a paragraph. The box around it is a tab stop
          only while the reasoning actually overflows max-h-64. */}
      <WhyMushiBelieves why={node.why} />
      {linkList('Based on', from)}
      {linkList('Leads to', to)}
      <div className="flex flex-wrap items-center gap-3 text-2xs">
        {node.anchor && (
          <a href={`#${node.anchor}`} className="text-link underline-offset-2 hover:underline">
            Show the evidence on this page ↓
          </a>
        )}
        {node.href && (
          <a href={node.href} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
            Open ↗
          </a>
        )}
      </div>
      <p className="font-mono text-3xs text-fg-faint">from {node.source}</p>
    </div>
  )
}

export function ReportDiagnosisGraph({ report }: { report: ReportDetail }) {
  const graph = useMemo(() => buildDiagnosisGraph(report), [report])
  const [selected, setSelected] = useState<string | null>(() => initialDiagnosisSelection(graph))
  useEffect(() => {
    if (!selected || !graph.nodes.some((n) => n.id === selected)) setSelected(initialDiagnosisSelection(graph))
  }, [graph, selected])

  const wide = useMediaQuery('(min-width: 64rem)', true)
  const canvas = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  // Below lg the panel sits under all five lanes; bring it into view so a
  // tap on a node shows its reasoning instead of nothing.
  const select = (id: string) => {
    setSelected(id)
    if (!wide) requestAnimationFrame(() => panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
  }
  const paths = useEdgePaths(canvas, graph, wide)
  const onPath = useMemo(() => new Set(graph.path), [graph.path])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes])
  const marks = graph.nodes.filter((n) => n.needsLook).length
  const node = selected ? byId.get(selected) ?? null : null

  return (
    <Card className="mb-3 p-3 motion-safe:animate-mushi-fade-in" data-testid="report-diagnosis-graph">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <IconGraph className="h-4 w-4 text-fg-muted" aria-hidden />
        <h3 className="text-sm font-semibold text-fg">How Mushi reached this diagnosis</h3>
        <Badge className={`${VERDICT_TONE[graph.verdict.tone]} text-3xs`}>{graph.verdict.label}</Badge>
        {marks > 0 && (
          <span className="text-2xs text-fg-muted">
            {marks === 1 ? '1 thing to check' : `${marks} things to check`}
          </span>
        )}
      </div>

      <ol className="mb-3 grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Path to the diagnosis">
        {graph.path.map((id, i) => {
          const n = byId.get(id)!
          return (
            <li key={id} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="w-4 shrink-0 text-right font-mono text-3xs text-fg-faint">{i + 1}.</span>
              <button
                type="button"
                onClick={() => select(id)}
                aria-current={selected === id ? 'step' : undefined}
                className={`min-w-0 truncate text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${selected === id ? 'font-semibold text-fg' : 'text-link'}`}
                title={n.title}
              >
                {n.title}
              </button>
              <StateChip node={n} />
            </li>
          )
        })}
      </ol>

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="min-w-0 overflow-x-auto lg:col-span-4">
          <div ref={canvas} className="relative grid gap-3 lg:min-w-3xl lg:grid-cols-5 lg:gap-x-9 lg:gap-y-3">
            {wide && (
              <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                {paths.map((p) => {
                  const touches = selected != null && (p.from === selected || p.to === selected)
                  const dim = selected != null && !touches
                  return (
                    <path
                      key={p.key}
                      d={p.d}
                      fill="none"
                      stroke={touches ? 'var(--color-brand)' : p.onPath ? 'var(--color-info)' : 'var(--color-edge)'}
                      strokeWidth={touches ? 2.25 : p.onPath ? 1.75 : 1.25}
                      opacity={dim ? 0.35 : 1}
                    />
                  )
                })}
              </svg>
            )}
            {DIAGNOSIS_LANES.map((lane) => {
              const laneNodes = graph.nodes.filter((n) => n.lane === lane.id)
              return (
                <section key={lane.id} aria-label={`${lane.label}: ${lane.hint}`} className="relative flex min-w-0 flex-col gap-2">
                  <header className="relative z-10 flex flex-col gap-0.5 border-b border-edge-subtle pb-1" title={lane.hint}>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${LANE_DOT[lane.id]}`} />
                      <span className="text-2xs font-semibold uppercase tracking-wider text-fg-secondary">{lane.label}</span>
                    </span>
                    <span className="text-3xs text-fg-faint">{lane.hint}</span>
                  </header>
                  {laneNodes.length === 0 ? (
                    <p className="relative z-10 text-2xs text-fg-faint">Nothing yet.</p>
                  ) : (
                    laneNodes.map((n) => (
                      <NodeButton key={n.id} node={n} selected={selected === n.id} onPath={onPath.has(n.id)} onSelect={select} />
                    ))
                  )}
                </section>
              )
            })}
          </div>
        </div>
        <aside ref={panel} className="min-w-0 scroll-mt-16 lg:sticky lg:top-3 lg:self-start" aria-label="Selected node">
          <Card variant="flat" className="p-3">
            <NodePanel node={node} graph={graph} onSelect={select} />
          </Card>
        </aside>
      </div>
    </Card>
  )
}
