/**
 * FILE: apps/docs/components/LoopComparison.tsx
 * PURPOSE: Side-by-side comparison of the linear top-down SDLC waterfall
 *   vs the Mushi bottom-up cumulative-selection loop.
 *
 * Left column: PM → dev → QA → user (classic waterfall).
 * Right column: User → Mushi → cluster → lesson → PR → reward → user.
 *
 * Styling: uses the same brand tokens as ComparisonTable.tsx — the right
 * column gets a subtle vermillion wash to match the editorial direction.
 * SVG arrows are deliberately simple so the diagram reads at small sizes.
 */
'use client'

interface StepProps {
  label: string
  sublabel?: string
  accent?: boolean
}

function Step({ label, sublabel, accent }: StepProps) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #c0392b)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 8,
        padding: '8px 14px',
        backgroundColor: accent
          ? 'color-mix(in srgb, var(--mushi-vermillion, #c0392b) 6%, transparent)'
          : 'var(--nextra-bg, transparent)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
      {sublabel && (
        <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{sublabel}</div>
      )}
    </div>
  )
}

function Arrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, margin: '2px 0' }}>
      {label && <span style={{ fontSize: 10, opacity: 0.6 }}>{label}</span>}
      <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
        <path d="M8 0 L8 14 M4 10 L8 18 L12 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function CycleArrow() {
  return (
    <div style={{ textAlign: 'center', margin: '6px 0', fontSize: 11, opacity: 0.55 }}>
      ↻ cumulative — each loop encodes a new rule
    </div>
  )
}

const LINEAR_STEPS = [
  { label: 'PM defines spec',   sublabel: 'Months of research' },
  { label: 'Dev implements',    sublabel: 'Works on my machine' },
  { label: 'QA tests',          sublabel: 'Mostly happy paths' },
  { label: 'Ships to user',     sublabel: 'Feedback? Support ticket' },
  { label: 'Bug reported',      sublabel: 'Jira ticket, someday' },
  { label: '≥ 2 sprints later', sublabel: 'Fixed (maybe)' },
]

const LOOP_STEPS = [
  { label: 'User feels friction',  sublabel: 'shake-to-report',            accent: false },
  { label: 'Mushi captures',       sublabel: 'screenshot + breadcrumbs',   accent: false },
  { label: 'Mistake DB clusters',  sublabel: 'same issue collapses to one', accent: true  },
  { label: 'Lesson promoted',      sublabel: 'rule named + encoded',        accent: true  },
  { label: 'Draft PR opened',      sublabel: 'agent runs against lessons',  accent: false },
  { label: 'Reporter credited',    sublabel: '"Kenji helped fix this"',     accent: false },
]

export function LoopComparison() {
  return (
    <div
      className="not-prose my-8"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        maxWidth: 720,
        margin: '32px auto',
      }}
    >
      {/* Left: linear SDLC */}
      <div>
        <div
          style={{
            textAlign: 'center',
            fontWeight: 700,
            fontSize: 13,
            marginBottom: 12,
            opacity: 0.55,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}
        >
          Linear top-down SDLC
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LINEAR_STEPS.map((s, i) => (
            <div key={s.label}>
              <Step label={s.label} sublabel={s.sublabel} />
              {i < LINEAR_STEPS.length - 1 && <Arrow />}
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, opacity: 0.5 }}>
          One-way. Feedback costs days to weeks.
        </div>
      </div>

      {/* Right: Mushi loop */}
      <div>
        <div
          style={{
            textAlign: 'center',
            fontWeight: 700,
            fontSize: 13,
            marginBottom: 12,
            color: 'var(--mushi-vermillion, #c0392b)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}
        >
          Mushi cumulative loop
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LOOP_STEPS.map((s, i) => (
            <div key={s.label}>
              <Step label={s.label} sublabel={s.sublabel} accent={s.accent} />
              {i < LOOP_STEPS.length - 1 && (
                <Arrow label={i === 2 ? 'cohence ≥ 0.75' : undefined} />
              )}
            </div>
          ))}
        </div>
        <CycleArrow />
        <div
          style={{
            textAlign: 'center',
            marginTop: 4,
            fontSize: 11,
            color: 'var(--mushi-vermillion, #c0392b)',
          }}
        >
          Selection with memory. Each loop encodes a permanent rule.
        </div>
      </div>
    </div>
  )
}
