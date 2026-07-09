/** Side-by-side visual argument for why cumulative selection beats the */
'use client'

import { VIZ } from '../lib/viz-tokens'
import { DiagramFigure } from './diagram-primitives'

interface StepProps {
  label: string
  sublabel?: string
  /** Marks the node where selection pressure peaks (vermillion border + bg). */
  accent?: boolean
  /** Small glyph appended to the sublabel — used for the genome-encoding node. */
  glyph?: string
}

function Step({ label, sublabel, accent, glyph }: StepProps) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 8,
        padding: '9px 14px',
        backgroundColor: accent
          ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 7%, transparent)'
          : 'var(--nextra-bg, transparent)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.3,
          color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
        }}
      >
        {label}
      </div>
      {sublabel && (
        <div
          style={{
            fontSize: 11,
            opacity: accent ? 0.8 : 0.6,
            marginTop: 3,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.04em',
            color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
          }}
        >
          {sublabel}
          {glyph ? (
            <span aria-label={glyph === '🧬' ? 'genome encoded' : undefined} style={{ marginLeft: 4 }}>
              {glyph}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Arrow({ label, vermillion }: { label?: string; vermillion?: boolean }) {
  const color = vermillion ? 'var(--mushi-vermillion, #e03c2c)' : 'currentColor'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, margin: '2px 0' }}>
      {label && (
        <span
          style={{
            fontSize: 11,
            opacity: 0.7,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            color: vermillion ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
      )}
      <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
        <path
          d="M8 0 L8 14 M4 10 L8 18 L12 10"
          stroke={color}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/** Animated circular return arrow indicating the loop re-enters the top. */
function LoopReturnArrow() {
  return (
    <div
      style={{
        textAlign: 'center',
        margin: '8px 0 4px',
        fontSize: 12,
        color: 'var(--mushi-vermillion, #e03c2c)',
        fontFamily: 'var(--mushi-font-mono, monospace)',
        letterSpacing: '0.05em',
        opacity: 0.85,
      }}
    >
      ↻ selection with memory — each loop lifts the fitness floor
    </div>
  )
}

const LINEAR_STEPS: StepProps[] = [
  { label: 'PM defines spec',   sublabel: 'months of research' },
  { label: 'Dev implements',    sublabel: 'works on my machine' },
  { label: 'QA signs off',      sublabel: 'happy paths only' },
  { label: 'Ships to user',     sublabel: 'feedback? support ticket' },
  { label: 'Bug reported',      sublabel: 'Jira ticket, someday' },
  { label: '≥ 2 sprints later', sublabel: 'fixed (maybe)' },
]

const LOOP_STEPS: StepProps[] = [
  { label: 'User feels friction',  sublabel: 'variation event',          accent: false },
  { label: 'Mushi captures',       sublabel: 'phenotype recorded',        accent: false },
  { label: 'Mistake DB clusters',  sublabel: 'selection pressure',        accent: true  },
  { label: 'Lesson encoded',       sublabel: '.mushi/lessons.json',       accent: true, glyph: '🧬' },
  { label: 'PR inherits genome',   sublabel: 'agent reads the ruleset',   accent: false },
  { label: 'Reporter credited',    sublabel: '"Kenji helped fix this"',   accent: false },
]

export function LoopComparison() {
  return (
    <DiagramFigure
      ariaLabel="Comparison of linear SDLC random walk without memory versus Mushi cumulative selection loop with genome encoding in lessons.json."
    >
      <div
        className="not-prose grid grid-cols-1 sm:grid-cols-2"
        style={{
          gap: 24,
          maxWidth: 740,
          margin: '0 auto',
        }}
      >
      {/* ── Left: random walk ── */}
      <div>
        <div
          style={{
            textAlign: 'center',
            fontWeight: 700,
            fontSize: 12,
            marginBottom: 12,
            opacity: 0.45,
            textTransform: 'uppercase',
            letterSpacing: '0.09em',
            fontFamily: 'var(--mushi-font-mono, monospace)',
          }}
        >
          Random walk — no memory
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LINEAR_STEPS.map((s, i) => (
            <div key={s.label}>
              <Step {...s} />
              {i < LINEAR_STEPS.length - 1 && <Arrow />}
            </div>
          ))}
        </div>
        <div
          style={{
            textAlign: 'center',
            marginTop: 12,
            fontSize: 11,
            opacity: 0.45,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.04em',
          }}
        >
          Fitness floor never rises. Mistakes repeat.
        </div>
      </div>

      {/* ── Right: cumulative selection ── */}
      <div>
        <div
          style={{
            textAlign: 'center',
            fontWeight: 700,
            fontSize: 12,
            marginBottom: 12,
            color: VIZ.accent,
            textTransform: 'uppercase',
            letterSpacing: '0.09em',
            fontFamily: 'var(--mushi-font-mono, monospace)',
          }}
        >
          Cumulative selection
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LOOP_STEPS.map((s, i) => (
            <div key={s.label}>
              <Step {...s} />
              {i < LOOP_STEPS.length - 1 && (
                <Arrow
                  label={i === 2 ? 'coherence ≥ 0.75' : undefined}
                  vermillion={s.accent || LOOP_STEPS[i + 1]?.accent}
                />
              )}
            </div>
          ))}
        </div>
        <LoopReturnArrow />
        <div
          style={{
            textAlign: 'center',
            marginTop: 4,
            fontSize: 11,
            color: VIZ.accent,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.04em',
          }}
        >
          Fitness compounds. The codebase evolves.
        </div>
      </div>
    </div>
    </DiagramFigure>
  )
}
