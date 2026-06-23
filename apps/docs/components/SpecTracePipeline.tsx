import { VIZ } from '../lib/viz-tokens'
import { DiagramFigure } from './diagram-primitives'

interface StageProps {
  step: number
  title: string
  detail: string
  accent?: boolean
  last?: boolean
}

function Stage({ step, title, detail, accent, last }: StageProps) {
  const accentColor = VIZ.accent
  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Left rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: `2px solid ${accent ? accentColor : VIZ.nodeBorder}`,
            background: accent
              ? VIZ.accentWash
              : VIZ.nodeBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: accent ? accentColor : 'var(--nextra-content-secondary, #6b7280)',
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          {step}
        </div>
        {!last && (
          <div
            style={{
              width: 2,
              flex: 1,
              minHeight: 20,
              background: accent
                ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 30%, var(--nextra-border, #e5e7eb))'
                : 'var(--nextra-border, #e5e7eb)',
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ paddingBottom: last ? 0 : 18, paddingTop: 2, flex: 1 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            marginBottom: 4,
            color: accent ? accentColor : 'inherit',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            opacity: 0.7,
            lineHeight: 1.55,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.02em',
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  )
}

const STAGES = [
  { title: 'User report arrives', detail: 'classify-report writes graph_edge (reports_against) linking the report to the inventory Action node', accent: false },
  { title: 'Action node resolved', detail: 'inventory.yaml expected_outcome loaded — HTTP status, JSONPath assertions, DB row checks, UI text', accent: true },
  { title: 'Fix dispatched', detail: 'POST /v1/admin/fixes/dispatch (or A2A /v1/a2a/tasks, MCP dispatch_fix) — may carry { inventoryActionNodeId }', accent: false },
  { title: 'inventory_action_node_id persisted', detail: 'fix_dispatch_jobs.inventory_action_node_id set. Worker cannot lose the pointer mid-run.', accent: false },
  { title: 'LLM prompt includes spec block', detail: 'fix-worker calls renderSpecContext() → Markdown spec injected: Action, page, story, every assertion in the contract', accent: true },
  { title: 'Pre-PR gate runs', detail: 'validateAgainstSpec() → HARD ERROR if diff removes a json_path field the contract asserts on. Soft warnings to spec_validation_warnings JSONB.', accent: false },
  { title: 'PR opened + fix_attempts stamped', detail: 'GitHub PR linked. fix_attempts.inventory_action_node_id FK set. Spec warnings surfaced as a callout in the Fixes drawer.', accent: false },
  { title: 'Synthetic probe queued', detail: "synthetic_runs row inserted (status='queued_post_pr'). Monitor cron drains with priority on its next tick.", accent: true },
  { title: 'Outcome verified', detail: 'HTTP probe evaluates expected_outcome. Status reconciler flips the Action to verified or regressed in the admin UI.', accent: true },
]

export function SpecTracePipeline() {
  return (
    <DiagramFigure ariaLabel="Nine-stage spec traceability pipeline from inventory contract through fix PR, validation gate, synthetic probe, and outcome verification.">
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          opacity: 0.4,
          marginBottom: 18,
          fontFamily: 'var(--mushi-font-mono, monospace)',
        }}
      >
        Spec traceability — read & write
      </div>
      {STAGES.map((s, i) => (
        <Stage key={s.title} step={i + 1} title={s.title} detail={s.detail} accent={s.accent} last={i === STAGES.length - 1} />
      ))}
    </DiagramFigure>
  )
}
