'use client'

import { VIZ } from '../lib/viz-tokens'
import {
  DiagramFigure,
  DiagramHArrow,
  DiagramNode,
  DiagramVArrow,
} from './diagram-primitives'

const GATES = [
  { num: '1', title: 'no-dead-handler', desc: 'Empty onClick / onSubmit', tag: 'ESLint static', color: VIZ.info },
  { num: '2', title: 'no-mock-leak', desc: 'Faker / placeholder data in non-test paths', tag: 'ESLint static', color: VIZ.info },
  { num: '3', title: 'Inventory drift', desc: 'Actions added, removed, or renamed', tag: 'Action runner', color: VIZ.warn },
  { num: '4', title: 'Agentic failure', desc: 'Handler regressions across deploys', tag: 'Action runner', color: VIZ.warn },
  { num: '5', title: 'Synthetic walk', desc: "Monitor's last walk against staging", tag: 'Synthetic monitor', color: VIZ.accent },
]

const INVENTORY_MODEL_ARIA =
  'Inventory model: project to story to page to element to action, with expected_outcome asserted below the action node.'

/** Visual model diagram: project → story → page → element → action → expected_outcome */
export function InventoryModelDiagram() {
  return (
    <DiagramFigure ariaLabel={INVENTORY_MODEL_ARIA}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 }}>
        <DiagramNode label="project" style={{ flex: '0 0 auto', minWidth: 72 }} />
        <DiagramHArrow />
        <DiagramNode label="story" sub="user-facing goal" style={{ flex: '0 0 auto' }} />
        <DiagramHArrow />
        <DiagramNode label="page" sub="/route" style={{ flex: '0 0 auto' }} />
        <DiagramHArrow />
        <DiagramNode label="element" sub="data-testid" style={{ flex: '0 0 auto' }} />
        <DiagramHArrow />
        <DiagramNode label="action" sub="click / type / submit" accent style={{ flex: '0 0 auto' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <DiagramVArrow label="asserts" />
          <DiagramNode label="expected_outcome" sub="status · JSONPath · DB · UI text" accent style={{ flex: '0 0 auto' }} />
        </div>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 11, opacity: 0.55, textAlign: 'center', fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Every <strong>action</strong> carries an <strong>expected_outcome</strong> contract — the source of truth for gates, agents, and the synthetic monitor.
      </p>
    </DiagramFigure>
  )
}

const GATES_ARIA = 'Five inventory quality gates: dead handler lint, mock leak lint, inventory drift, agentic failure, synthetic walk.'

/** 5-gate composite check strip */
export function GatesStrip() {
  return (
    <div className="not-prose my-6" role="img" aria-label={GATES_ARIA}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {GATES.map((g) => (
          <div
            key={g.num}
            style={{
              border: `1.5px solid ${VIZ.nodeBorder}`,
              borderRadius: 10,
              padding: '12px 14px',
              backgroundColor: VIZ.nodeBg,
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: g.color,
                  color: VIZ.selectedFg,
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {g.num}
              </span>
              <code style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em', wordBreak: 'break-all' }}>{g.title}</code>
            </div>
            <p style={{ fontSize: 11, margin: 0, opacity: 0.7, lineHeight: 1.4 }}>{g.desc}</p>
            <span
              style={{
                display: 'inline-block',
                marginTop: 8,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 4,
                background: 'color-mix(in srgb, currentColor 8%, transparent)',
                opacity: 0.65,
                fontFamily: 'var(--mushi-font-mono, monospace)',
              }}
            >
              {g.tag}
            </span>
          </div>
        ))}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11, opacity: 0.5, textAlign: 'center', fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Gates 1–2 are static (no network). Gates 3–5 talk to the Mushi gateway. All five roll up into <code>mushi-mushi/gates</code>.
      </p>
    </div>
  )
}
