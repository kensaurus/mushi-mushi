/**
 * FILE: apps/docs/components/EvolutionDiagram.tsx
 * PURPOSE: Closed-loop pipeline diagram — HTML/CSS, same visual language as
 *   LoopComparison.tsx so theme tokens resolve correctly in light + dark mode.
 *
 * WHY NOT SVG?
 * SVG `<style>` blocks and `fill="var(...)"` attributes don't reliably inherit
 * Nextra/Mushi theme tokens after static export. The production site rendered
 * black node fills with illegible red-on-black text. Div-based nodes with
 * inline styles (identical to LoopComparison's Step component) fix this.
 */
'use client'

// ── Shared node primitive (mirrors LoopComparison Step) ───────────────────────
interface NodeProps {
  label: string
  sub: string
  accent?: boolean
  compact?: boolean
}

function Node({ label, sub, accent, compact }: NodeProps) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 8,
        padding: compact ? '7px 10px' : '9px 12px',
        backgroundColor: accent
          ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 7%, transparent)'
          : 'var(--nextra-bg, transparent)',
        textAlign: 'center',
        minWidth: compact ? 72 : 80,
        flex: '1 1 0',
      }}
    >
      <div
        style={{
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          lineHeight: 1.25,
          color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 9.5,
          opacity: accent ? 0.75 : 0.55,
          marginTop: 2,
          fontFamily: 'var(--mushi-font-mono, monospace)',
          letterSpacing: '0.04em',
          color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
        }}
      >
        {sub}
      </div>
    </div>
  )
}

function HArrow({ label, accent }: { label?: string; accent?: boolean }) {
  const color = accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #cbd5e1)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 28,
        gap: 2,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 8,
            opacity: 0.65,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.06em',
            color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      )}
      <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden>
        <path
          d="M0 6 H18 M14 2 L22 6 L14 10"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function VArrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {label && (
        <span
          style={{
            fontSize: 8,
            opacity: 0.55,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
      )}
      <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden>
        <path
          d="M6 0 L6 12 M2 8 L6 16 L10 8"
          stroke="var(--nextra-border, #cbd5e1)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export function EvolutionDiagram() {
  return (
    <div
      className="not-prose my-8 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5"
      role="img"
      aria-label="Mushi closed loop: user reports friction, SDK captures, Mistake DB clusters, Learning rule encoded, PR review inherits genome, Reward loop credits reporter, cycles back to user. Drift and PDCA agents feed findings into Mistake DB."
    >
      {/* Row 1 — main pipeline */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        <Node label="End user" sub="feels friction" />
        <HArrow label="report" />
        <Node label="Mushi SDK" sub="shake to report" />
        <HArrow label="embed" accent />
        <Node label="Mistake DB" sub="vector cluster" accent />
        <HArrow label="promote" accent />
        <Node label="Learning rule" sub="named + encoded" accent />
        <HArrow label="inject" />
        <Node label="PR review" sub="rule injected" />
        <HArrow label="merge" />
        <Node label="Reward loop" sub="credits reporter" />
      </div>

      {/* Row 2 — autonomous agents feeding Mistake DB
           Centering below Mistake DB (3rd of 6 nodes) is approximate — the row
           scrolls horizontally as a unit so pixel-perfect alignment isn't possible
           without measuring the DOM. The visual intent is "agents feed upward into
           the middle of the pipeline". */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          marginTop: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <VArrow label="findings" />
          <Node label="Drift agent" sub="walks live app" compact />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <VArrow label="regressions" />
          <Node label="PDCA agent" sub="N iterations" compact />
        </div>
      </div>

      {/* Return loop */}
      <div
        style={{
          textAlign: 'center',
          marginTop: 14,
          fontSize: 11,
          color: 'var(--mushi-vermillion, #e03c2c)',
          fontFamily: 'var(--mushi-font-mono, monospace)',
          letterSpacing: '0.05em',
          opacity: 0.85,
        }}
      >
        ↻ thank — reporter credited → next session starts the loop again
      </div>

      <p
        className="not-prose mt-3 flex items-center justify-center gap-1.5 text-center text-xs"
        style={{ color: 'var(--nextra-content-secondary, #6b7280)' }}
      >
        The Mushi closed loop —
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: 2,
            border: '1.5px solid var(--mushi-vermillion, #e03c2c)',
            background: 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 7%, transparent)',
            verticalAlign: 'middle',
          }}
        />
        selection nodes (Mistake DB + Learning rule)
      </p>
    </div>
  )
}
