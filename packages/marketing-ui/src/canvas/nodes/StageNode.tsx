import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { StageNodeData, StageTone } from '../data'

const TONE_STYLES: Record<StageTone, { bg: string; fg: string; border: string }> = {
  alert: { bg: 'var(--mushi-vermillion)', fg: '#ffffff', border: 'var(--mushi-vermillion)' },
  count: { bg: 'var(--mushi-ink)', fg: 'var(--mushi-paper)', border: 'var(--mushi-ink)' },
  link: {
    bg: 'color-mix(in oklch, var(--mushi-ink) 12%, var(--mushi-paper))',
    fg: 'var(--mushi-ink)',
    border: 'var(--mushi-rule)',
  },
  pass: { bg: '#10b981', fg: '#ffffff', border: '#059669' },
  memory: {
    bg: 'color-mix(in oklch, var(--mushi-vermillion) 12%, var(--mushi-paper))',
    fg: 'var(--mushi-vermillion-ink)',
    border: 'color-mix(in oklch, var(--mushi-vermillion) 35%, var(--mushi-rule))',
  },
}

export function StageNode({ data }: NodeProps) {
  const nodeData = data as StageNodeData
  const { stage, focused, selected, onSelect } = nodeData
  const tone = TONE_STYLES[stage.tone]

  return (
    <button
      type="button"
      className={`mushi-stage-node nodrag nopan group ${focused ? 'is-focused' : ''} ${selected ? 'is-selected' : ''}`}
      aria-expanded={selected}
      aria-label={`Explore ${stage.title}`}
      onPointerDown={() => onSelect(stage.id)}
      onClick={() => onSelect(stage.id)}
    >
      <Handle id="top" type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="top-out" type="source" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="right" type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="right-in" type="target" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="bottom-in" type="target" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="left" type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
      <Handle id="left-out" type="source" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-transparent !opacity-0" />

      <div className="flex items-start justify-between gap-2">
        {/* "01" stage index demoted from vermillion → ink. Five cards in the
            row used to render five vermillion-numbered chips even when none
            were active — a constant red-dot grid of "look at me, look at me,
            look at me". Now the index reads as a calm caption and the active
            signal is carried entirely by the card's bottom rail + ring (set
            by .is-focused / .is-selected in styles.css), which is the single
            accent zone for the canvas. */}
        <span className="rounded-sm border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-ink)]">
          {String(stage.index + 1).padStart(2, '0')}
        </span>
        {/* Right stat keeps its semantic tone (alert=red, pass=green, etc.).
            These tones *carry* meaning per stage and so they earn the colour. */}
        <span
          className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}` }}
        >
          {stage.tone === 'pass' && (
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: tone.fg }} />
          )}
          {stage.tone === 'alert' && (
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: tone.fg }} />
          )}
          {stage.stat}
        </span>
      </div>

      {/* Kicker (mushi.web · shake / triage.llm · 28 ms / …): demoted to
          ink-faint. It's metadata, not a status — the title underneath is
          what the reader scans. Vermillion here was decoration that pushed
          the per-card brand-tinted-element count to 3+. */}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-faint)]">
        {stage.kicker}
      </p>
      <h3 className="mt-1.5 font-serif text-[1.5rem] leading-[1.08] tracking-[-0.03em] text-[var(--mushi-ink)]">
        {stage.title}
      </h3>
      <p className="mt-2.5 text-left text-[13px] leading-[1.55] text-[var(--mushi-ink-muted)]">
        {stage.oneLiner}
      </p>
      {/* "Inspect →" — keep the brand colour on hover (it earns the affordance
          tint for one card at a time, the one the cursor is on); idle state
          stays neutral. */}
      <span className="mt-3.5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--mushi-ink-muted)] transition group-hover:text-[var(--mushi-vermillion)]">
        Inspect
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
      </span>
    </button>
  )
}
