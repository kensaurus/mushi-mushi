/**
 * FILE: apps/admin/src/components/design/DesignRulesConfig.tsx
 * PURPOSE: Edit the deviance rules (enabled, severity, allow-lists, and the
 *          primitive map for raw_interactive_element) and propose the change
 *          as a draft PR against mushi.recipe.json. Only changed fields are
 *          sent. The preview → confirm flow is shared with token edits.
 */

import { useMemo, useState } from 'react'
import { Badge, Btn, DataTableCell, DataTableHead, ErrorAlert, Section, Toggle } from '../ui'
import { DESIGN_RULE_IDS } from '../../lib/recipeTypes'
import type { DesignEditability, DesignRuleConfig, DesignRuleId, FindingSeverity } from '../../lib/recipeTypes'
import { diffRuleDraft, ruleLabel, ruleToDraft, type RuleChange, type RuleDraft } from './designTokens'
import { DesignChangePreview } from './DesignChangePreview'
import { changeLocksInputs, type DesignChangeState } from './useDesignChange'

const SEVERITIES: FindingSeverity[] = ['info', 'warn', 'error']

/** Canonical rule order from the contract; rules it does not know go last. */
function orderRules(rules: DesignRuleConfig[]): DesignRuleConfig[] {
  const rank = (id: string) => {
    const i = (DESIGN_RULE_IDS as readonly string[]).indexOf(id)
    return i === -1 ? DESIGN_RULE_IDS.length : i
  }
  return [...rules].sort((a, b) => rank(a.id) - rank(b.id))
}
const FIELD_CLS =
  'w-full rounded-sm border border-edge-subtle bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

interface DesignRulesConfigProps {
  rules: DesignRuleConfig[]
  editable: DesignEditability
  change: DesignChangeState
  onPreview: (rules: Partial<Record<DesignRuleId, RuleChange>>) => void
  onConfirm: () => void
  onDiscard: () => void
}

export function DesignRulesConfig({ rules, editable, change, onPreview, onConfirm, onDiscard }: DesignRulesConfigProps) {
  // Drafts are keyed by the server's rules so a reload with new values resets them.
  const rulesKey = JSON.stringify(rules)
  const [drafts, setDrafts] = useState<{ key: string; byId: Record<string, RuleDraft> }>(() => ({
    key: rulesKey,
    byId: Object.fromEntries(rules.map((r) => [r.id, ruleToDraft(r)])),
  }))
  const current =
    drafts.key === rulesKey ? drafts.byId : Object.fromEntries(rules.map((r) => [r.id, ruleToDraft(r)]))
  const canWrite = editable.manifestWritable
  // Inputs freeze while a preview/PR request runs or its PR result is shown.
  const locked = changeLocksInputs(change)
  const inputsOff = !canWrite || locked

  const diff = useMemo(() => {
    const changes: Partial<Record<DesignRuleId, RuleChange>> = {}
    const errors: string[] = []
    for (const rule of rules) {
      const draft = current[rule.id]
      if (!draft) continue
      const d = diffRuleDraft(rule, draft)
      if (!d.ok) errors.push(`${ruleLabel(rule.id)}: ${d.error}`)
      else if (d.change) changes[rule.id] = d.change
    }
    return { changes, errors, count: Object.keys(changes).length }
  }, [rules, current])

  const update = (id: DesignRuleId, patch: Partial<RuleDraft>) => {
    const base = current[id]
    if (!base) return
    setDrafts({ key: rulesKey, byId: { ...current, [id]: { ...base, ...patch } } })
    // Any edit invalidates a preview — confirm may only send what was shown.
    if (change.phase === 'previewed' || change.phase === 'error') onDiscard()
  }

  const proposeDisabledReason = !canWrite
    ? editable.reason ?? 'mushi.recipe.json is not writable for this project.'
    : diff.errors.length > 0
      ? 'Fix the highlighted rule first.'
      : diff.count === 0
        ? 'Change a rule first.'
        : locked
          ? 'Finish or discard the current change first.'
          : null

  return (
    <Section title="Deviance rules">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-secondary">
          Rules live in your repo&apos;s mushi.recipe.json; tightening them each iteration is how the app converges on
          its design system.
        </p>
        {!canWrite && (
          <p className="text-xs text-fg-muted">Read-only: {editable.reason ?? 'mushi.recipe.json is not writable for this project.'}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-xs">
            <thead>
              <tr>
                <DataTableHead>Rule</DataTableHead>
                <DataTableHead>Enabled</DataTableHead>
                <DataTableHead>Severity</DataTableHead>
                <DataTableHead>Allowed values</DataTableHead>
                <DataTableHead>Skipped files</DataTableHead>
                <DataTableHead>Source</DataTableHead>
              </tr>
            </thead>
            <tbody>
              {orderRules(rules).map((rule) => {
                const d = current[rule.id] ?? ruleToDraft(rule)
                return (
                  <tr key={rule.id} className="border-t border-edge-subtle align-top">
                    <DataTableCell>
                      <span className="flex flex-col gap-1">
                        <span className="text-fg">{ruleLabel(rule.id)}</span>
                        <span className="font-mono text-2xs text-fg-faint">{rule.id}</span>
                        {rule.id === 'raw_interactive_element' && (
                          <label className="flex flex-col gap-0.5 text-2xs text-fg-muted">
                            Primitives (element=Component)
                            <input
                              className={FIELD_CLS}
                              value={d.primitives}
                              disabled={inputsOff}
                              placeholder="button=Btn, a=Link"
                              onChange={(e) => update(rule.id, { primitives: e.target.value })}
                            />
                          </label>
                        )}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <Toggle
                        checked={d.enabled}
                        disabled={inputsOff}
                        onChange={(v) => update(rule.id, { enabled: v })}
                        ariaLabel={`${ruleLabel(rule.id)} enabled`}
                      />
                    </DataTableCell>
                    <DataTableCell>
                      <select
                        className={FIELD_CLS}
                        value={d.severity}
                        disabled={inputsOff}
                        aria-label={`${ruleLabel(rule.id)} severity`}
                        onChange={(e) => update(rule.id, { severity: e.target.value as FindingSeverity })}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </DataTableCell>
                    <DataTableCell>
                      <input
                        className={`${FIELD_CLS} font-mono`}
                        value={d.allowValues}
                        disabled={inputsOff}
                        aria-label={`${ruleLabel(rule.id)} allowed values, comma separated`}
                        placeholder="comma separated"
                        onChange={(e) => update(rule.id, { allowValues: e.target.value })}
                      />
                    </DataTableCell>
                    <DataTableCell>
                      <input
                        className={`${FIELD_CLS} font-mono`}
                        value={d.allowFiles}
                        disabled={inputsOff}
                        aria-label={`${ruleLabel(rule.id)} skipped file globs, comma separated`}
                        placeholder="e.g. src/legacy/**"
                        onChange={(e) => update(rule.id, { allowFiles: e.target.value })}
                      />
                    </DataTableCell>
                    <DataTableCell>
                      {rule.fromManifest ? <Badge tone="info">mushi.recipe.json</Badge> : <Badge tone="neutral">Mushi default</Badge>}
                    </DataTableCell>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {diff.errors.length > 0 && <ErrorAlert message={diff.errors.join(' ')} />}
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            size="sm"
            variant="primary"
            onClick={() => onPreview(diff.changes)}
            disabled={proposeDisabledReason !== null}
            loading={change.phase === 'previewing'}
            title={proposeDisabledReason ?? 'Preview the mushi.recipe.json diff before opening a draft PR'}
          >
            Propose rules change
          </Btn>
          {diff.count > 0 && (
            <span className="text-2xs text-fg-muted">
              {diff.count} rule{diff.count === 1 ? '' : 's'} changed
            </span>
          )}
        </div>
        <DesignChangePreview state={change} onConfirm={onConfirm} onDiscard={onDiscard} />
      </div>
    </Section>
  )
}
