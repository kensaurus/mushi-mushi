/**
 * FILE: apps/docs/components/EvolutionDiagram.tsx
 * PURPOSE: Animated SVG diagram showing the closed-loop feedback system
 *   that Mushi enables — catch the bug → cluster it → name it → encode it
 *   as a heuristic → inject into next PR → reward the user → repeat.
 *
 * Reuses brand tokens (--mushi-vermillion, --mushi-ink) from globals.css.
 * Renders dark/light correctly via currentColor and CSS custom properties.
 * Animation is CSS-only (no framer-motion dependency in the docs app).
 */
'use client'

import { useEffect, useRef } from 'react'

interface Node {
  id: string
  label: string
  sublabel?: string
  x: number
  y: number
  accent?: boolean
}

const NODES: Node[] = [
  { id: 'user',    label: 'End user',      sublabel: 'feels friction',       x: 50,  y: 50,  accent: false },
  { id: 'sdk',     label: 'Mushi SDK',     sublabel: 'shake to report',      x: 220, y: 50,  accent: false },
  { id: 'cluster', label: 'Mistake DB',    sublabel: 'vector cluster',       x: 395, y: 50,  accent: true  },
  { id: 'lesson',  label: 'Learning rule', sublabel: 'named + summarised',   x: 570, y: 50,  accent: true  },
  { id: 'pr',      label: 'PR review',     sublabel: 'rule injected at 3kt', x: 745, y: 50,  accent: false },
  { id: 'reward',  label: 'Reward loop',   sublabel: 'credits reporter',     x: 395, y: 160, accent: false },
  { id: 'drift',   label: 'Drift agent',   sublabel: 'walks live app',       x: 570, y: 160, accent: false },
  { id: 'pdca',    label: 'PDCA agent',    sublabel: 'N iterations',         x: 745, y: 160, accent: false },
]

const EDGES: Array<{ from: string; to: string; label?: string; back?: boolean }> = [
  { from: 'user',    to: 'sdk',     label: 'report' },
  { from: 'sdk',     to: 'cluster', label: 'embed' },
  { from: 'cluster', to: 'lesson',  label: 'promote' },
  { from: 'lesson',  to: 'pr',      label: 'inject' },
  { from: 'pr',      to: 'reward',  label: 'merge', back: true },
  { from: 'reward',  to: 'user',    label: 'thank' },
  { from: 'drift',   to: 'cluster', label: 'findings' },
  { from: 'pdca',    to: 'cluster', label: 'regressions' },
]

function nodeById(id: string) {
  return NODES.find((n) => n.id === id)!
}

function edgePath(from: Node, to: Node) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const mx = from.x + dx * 0.5
  const my = from.y + dy * 0.5 + (Math.abs(dy) < 5 ? -18 : 0)
  return `M ${from.x + 52} ${from.y + 22} Q ${mx} ${my} ${to.x} ${to.y + 22}`
}

export function EvolutionDiagram() {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const nodes = svgRef.current?.querySelectorAll<SVGElement>('.evo-node')
    if (!nodes) return
    nodes.forEach((el, i) => {
      el.style.animationDelay = `${i * 80}ms`
    })
  }, [])

  return (
    <div className="not-prose my-8 overflow-x-auto rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-4">
      <svg
        ref={svgRef}
        viewBox="0 0 820 220"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Mushi closed-loop diagram: end user reports → SDK → mistake DB → learning rule → PR review → reward loop back to end user; drift agent and PDCA agent feed discoveries back into the mistake DB"
        className="w-full max-w-[820px] mx-auto"
        style={{ minWidth: 540 }}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--mushi-vermillion, #c0392b)" />
          </marker>
          <style>{`
            .evo-node { animation: evo-pop 0.4s ease both; }
            @keyframes evo-pop {
              from { opacity: 0; transform: scale(0.85); }
              to   { opacity: 1; transform: scale(1); }
            }
            .evo-edge {
              stroke: var(--mushi-vermillion, #c0392b);
              stroke-width: 1.5;
              fill: none;
              stroke-dasharray: 4 3;
              animation: evo-dash 0.8s linear infinite;
            }
            @keyframes evo-dash {
              to { stroke-dashoffset: -14; }
            }
            .evo-node-rect {
              fill: var(--nextra-bg, #fff);
              stroke: var(--nextra-border, #e5e7eb);
              stroke-width: 1.5;
              rx: 8;
            }
            .evo-node-rect.accent {
              stroke: var(--mushi-vermillion, #c0392b);
              stroke-width: 2;
            }
            .evo-label {
              font-family: inherit;
              font-size: 10.5px;
              font-weight: 600;
              fill: var(--nextra-content, currentColor);
            }
            .evo-sublabel {
              font-family: inherit;
              font-size: 8.5px;
              fill: var(--nextra-content-secondary, currentColor);
              opacity: 0.65;
            }
            .evo-edge-label {
              font-family: inherit;
              font-size: 8px;
              fill: var(--mushi-vermillion, #c0392b);
              font-weight: 500;
            }
          `}</style>
        </defs>

        {EDGES.map((e) => {
          const f = nodeById(e.from)
          const t = nodeById(e.to)
          const mid = { x: (f.x + t.x) / 2 + 26, y: (f.y + t.y) / 2 + 16 }
          return (
            <g key={`${e.from}-${e.to}`}>
              <path
                className="evo-edge"
                d={edgePath(f, t)}
                markerEnd="url(#arrow)"
              />
              {e.label && (
                <text className="evo-edge-label" x={mid.x} y={mid.y - 6} textAnchor="middle">
                  {e.label}
                </text>
              )}
            </g>
          )
        })}

        {NODES.map((n) => (
          <g key={n.id} className="evo-node" transform={`translate(${n.x}, ${n.y})`}>
            <rect
              className={`evo-node-rect${n.accent ? ' accent' : ''}`}
              width={104}
              height={44}
              rx={8}
            />
            <text className="evo-label" x={52} y={18} textAnchor="middle">
              {n.label}
            </text>
            {n.sublabel && (
              <text className="evo-sublabel" x={52} y={32} textAnchor="middle">
                {n.sublabel}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="text-center text-xs text-[color:var(--nextra-content-secondary)] mt-3 not-prose">
        The Mushi closed loop — <span style={{ color: 'var(--mushi-vermillion, #c0392b)' }}>red border</span> = new capabilities (Mistake DB + Learning rules)
      </p>
    </div>
  )
}
