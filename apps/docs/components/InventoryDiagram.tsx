'use client'

/** Shared primitive — matches EvolutionDiagram's Node */
function Node({ label, sub, accent, compact }: { label: string; sub?: string; accent?: boolean; compact?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 8,
        padding: compact ? '7px 12px' : '9px 14px',
        backgroundColor: accent
          ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 7%, transparent)'
          : 'var(--nextra-bg, transparent)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontSize: compact ? 11 : 12, fontWeight: 600, color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit' }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2, fontFamily: 'var(--mushi-font-mono, monospace)', letterSpacing: '0.04em' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function HArrow() {
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden style={{ flexShrink: 0, alignSelf: 'center' }}>
      <path d="M0 7 H18 M14 3 L22 7 L14 11" stroke="var(--nextra-border, #cbd5e1)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VArrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, margin: '2px 0' }}>
      {label && <span style={{ fontSize: 8.5, opacity: 0.5, fontFamily: 'var(--mushi-font-mono, monospace)' }}>{label}</span>}
      <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden>
        <path d="M6 0 L6 14 M2 10 L6 18 L10 10" stroke="var(--nextra-border, #cbd5e1)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const GATES = [
  { num: '1', title: 'no-dead-handler', desc: 'Empty onClick / onSubmit', tag: 'ESLint static', color: '#6366f1' },
  { num: '2', title: 'no-mock-leak', desc: 'Faker / placeholder data in non-test paths', tag: 'ESLint static', color: '#6366f1' },
  { num: '3', title: 'Inventory drift', desc: 'Actions added, removed, or renamed', tag: 'Action runner', color: '#f59e0b' },
  { num: '4', title: 'Agentic failure', desc: 'Handler regressions across deploys', tag: 'Action runner', color: '#f59e0b' },
  { num: '5', title: 'Synthetic walk', desc: "Monitor's last walk against staging", tag: 'Synthetic monitor', color: 'var(--mushi-vermillion, #e03c2c)' },
]

/** Visual model diagram: project → story → page → element → action → expected_outcome */
export function InventoryModelDiagram() {
  return (
    <div className="not-prose my-8 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5">
      {/* Hierarchy chain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 }}>
        <Node label="project" />
        <HArrow />
        <Node label="story" sub="user-facing goal" />
        <HArrow />
        <Node label="page" sub="/route" />
        <HArrow />
        <Node label="element" sub="data-testid" />
        <HArrow />
        <Node label="action" sub="click / type / submit" accent />
      </div>

      {/* Drop from action → expected_outcome */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <VArrow label="asserts" />
          <Node label="expected_outcome" sub="status · JSONPath · DB · UI text" accent />
        </div>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 11, opacity: 0.55, textAlign: 'center', fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Every <strong>action</strong> carries an <strong>expected_outcome</strong> contract — the source of truth for gates, agents, and the synthetic monitor.
      </p>
    </div>
  )
}

/** 5-gate composite check strip */
export function GatesStrip() {
  return (
    <div className="not-prose my-6">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {GATES.map((g) => (
          <div
            key={g.num}
            style={{
              border: '1.5px solid var(--nextra-border, #e5e7eb)',
              borderRadius: 10,
              padding: '12px 14px',
              backgroundColor: 'var(--nextra-bg, transparent)',
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
                  color: '#fff',
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
