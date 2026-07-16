import { Card, Badge, Btn, RelativeTime } from '../ui'
import { ConfigHelp } from '../ConfigHelp'
import {
  IconCopy,
  IconPencil,
  IconDiff,
  IconSliders,
  IconTrash,
} from '../icons'
import type { PromptVersion } from './types'
import { STAGE_LABELS } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

// Icon-only Btn override for the dense action column.
//
// Each prompt row carries up to six controls (Clone / Edit / Diff /
// Activate / Traffic / Delete) and the previous text-only treatment
// caused a 250 px wall of verbs that wrapped on tablet widths and
// drowned the row metadata. Compressing the secondaries to glyphs
// while keeping the text label on the *primary* forward action
// (Activate — the only verb that truly progresses the workflow loop)
// matches the "icons + tooltip for secondaries, text for primaries"
// rule the Btn JSDoc spells out and recovers the row to a single
// horizontal scan.
//
// `!px-1.5` shrinks the BTN_SIZES.sm `px-2` to a square inset so the
// glyph reads as a button face, not a left-aligned icon with empty
// trailing space. Tooltips + aria-labels are mandatory — without them
// the column becomes a screen-reader trap.
const ICON_BTN = '!px-1.5'

/**
 * Domain-local tone ramp for judge scores (0.80 ok / 0.60 warn / <0.60 danger).
 * Mirrors JudgePage's ScorePill so an 0.80 eval is green in both views. We
 * intentionally don't delegate to ui.tsx#Pct / tokens.ts#pctToneClass here —
 * those use a 90/70 ramp tuned for health success rates / uptime, which
 * recolours legitimate 0.80–0.89 judge scores from green to amber. See the
 * comment in JudgePage#ScorePill for the full rationale.
 */
function judgeScoreTone(score: number): string {
  if (score >= 0.8) return 'text-ok'
  if (score >= 0.6) return 'text-warn'
  return 'text-danger'
}

interface PromptStageTableProps {
  stage: 'stage1' | 'stage2'
  prompts: PromptVersion[]
  busy: string | null
  onClone: (p: PromptVersion) => void
  onEdit: (p: PromptVersion) => void
  onDiff: (p: PromptVersion) => void
  onActivate: (p: PromptVersion) => void
  onTraffic: (p: PromptVersion) => void
  onDelete: (p: PromptVersion) => void
}

export function PromptStageTable({
  stage,
  prompts,
  busy,
  onClone,
  onEdit,
  onDiff,
  onActivate,
  onTraffic,
  onDelete,
}: PromptStageTableProps) {
  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-fg-secondary">
          {STAGE_LABELS[stage]}
        </h3>
        <span className="text-2xs text-fg-faint font-mono">
          {prompts.length} versions
        </span>
      </div>
      {prompts.length === 0 ? (
        <p className="text-2xs text-fg-faint">No prompts registered for this stage.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-fg-faint">
              <tr>
                <th className="text-left font-normal px-2 py-1">Version</th>
                <th className="text-left font-normal px-2 py-1">State</th>
                <th className="text-right font-normal px-2 py-1">
                  <span className="inline-flex items-center gap-1">
                    Traffic
                    <ConfigHelp helpId="prompt-lab.traffic_percentage" />
                  </span>
                </th>
                <th className="text-right font-normal px-2 py-1">Judge score</th>
                <th className="text-right font-normal px-2 py-1">Evals</th>
                <th className="text-left font-normal px-2 py-1">Updated</th>
                <th className="text-right font-normal px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => {
                const isGlobal = p.project_id == null
                const score = p.avg_judge_score
                return (
                  <tr key={p.id} className="border-t border-edge-subtle">
                    <td className="px-2 py-1.5 font-mono text-fg-secondary truncate max-w-[10rem]">
                      {p.version}
                    </td>
                    <td className="px-2 py-1.5">
                      {p.is_active ? (
                        <Badge className={CHIP_TONE.okSubtle}>Active</Badge>
                      ) : p.is_candidate ? (
                        <Badge className={CHIP_TONE.infoSubtle}>Candidate</Badge>
                      ) : (
                        <Badge className="bg-fg-faint/15 text-fg-muted border border-edge-subtle">Idle</Badge>
                      )}
                      {isGlobal && (
                        <Badge className={`ml-1 ${CHIP_TONE.warnSubtle}`}>Global</Badge>
                      )}
                      {p.auto_generated && (
                        <Badge
                          className={`ml-1 ${CHIP_TONE.brandSubtle}`}
                          title={p.auto_generation_metadata?.changeSummary ?? 'Generated by prompt-auto-tune'}
                        >
                          Auto
                        </Badge>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-faint"
                      title={p.traffic_percentage === 100
                        ? 'This version receives 100 % of live traffic for its stage.'
                        : `Receives ${p.traffic_percentage} % of live traffic; the remainder routes to other candidates in the same stage.`}
                    >
                      {/* Traffic is a deliberate A/B split, not a quality
                          signal. Rendering it through the higher-better tone
                          ramp would paint 50/50 experiments and 0 % idle
                          candidates red ("something's broken!") when they're
                          working exactly as configured. Keep this neutral
                          and match the JudgePage leaderboard treatment. */}
                      {p.traffic_percentage}%
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {score == null ? (
                        <span className="text-fg-faint text-2xs font-mono">—</span>
                      ) : (
                        <span
                          className={`font-mono tabular-nums ${judgeScoreTone(score)}`}
                          title="Judge score — higher is better. Uses the rolling 7-day eval window."
                        >
                          {(score * 100).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-fg-muted tabular-nums">
                      {p.total_evaluations}
                    </td>
                    <td className="px-2 py-1.5 text-fg-muted">
                      <RelativeTime value={p.updated_at} />
                    </td>
                    <td className="px-2 py-1.5 text-right space-x-1 whitespace-nowrap">
                      <Btn
                        size="sm"
                        variant="ghost"
                        className={ICON_BTN}
                        disabled={busy === p.id}
                        onClick={() => onClone(p)}
                        title="Clone — create an editable copy"
                        aria-label="Clone prompt"
                      >
                        <IconCopy />
                      </Btn>
                      {!isGlobal && (
                        <>
                          <Btn
                            size="sm"
                            variant="ghost"
                            className={ICON_BTN}
                            disabled={busy === p.id}
                            onClick={() => onEdit(p)}
                            title="Edit prompt template"
                            aria-label="Edit prompt"
                          >
                            <IconPencil />
                          </Btn>
                          {p.parent_version_id && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              className={ICON_BTN}
                              disabled={busy === p.id}
                              onClick={() => onDiff(p)}
                              title="Diff against parent prompt"
                              aria-label="Diff against parent prompt"
                            >
                              <IconDiff />
                            </Btn>
                          )}
                          {!p.is_active && (
                            // Activate stays text — it's the page's
                            // primary forward action and "Activate" is
                            // a one-way swap of the live prompt; the
                            // explicit verb is the safety rail.
                            <Btn
                              size="sm"
                              variant="success"
                              disabled={busy === p.id}
                              onClick={() => onActivate(p)}
                              title="Make this the live prompt for this stage"
                            >
                              Activate
                            </Btn>
                          )}
                          {!p.is_active && (
                            <Btn
                              size="sm"
                              variant="ghost"
                              className={ICON_BTN}
                              disabled={busy === p.id}
                              onClick={() => onTraffic(p)}
                              title="Set A/B traffic share"
                              aria-label="Set A/B traffic share"
                            >
                              <IconSliders />
                            </Btn>
                          )}
                          <Btn
                            size="sm"
                            variant="danger"
                            className={ICON_BTN}
                            disabled={busy === p.id || p.is_active}
                            onClick={() => onDelete(p)}
                            title="Delete prompt"
                            aria-label="Delete prompt"
                          >
                            <IconTrash />
                          </Btn>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
