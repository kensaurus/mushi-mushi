/**
 * FILE: apps/admin/src/components/settings/CiPolicyCard.tsx
 * PURPOSE: Settings → General → "CI policy" (Plan 022 Phase 7b, ADR 0037).
 *          The organization's CI agreement as Mushi enforces it when someone
 *          asks to change where CI runs: no paid GitHub-hosted minutes on
 *          private repos (with exceptions), external controllers that own
 *          some repos (shown read-only on /ci), and standby runners that are
 *          never a target. Nothing is filled in for you: copy it from your
 *          agreement ("import from your CI agreement").
 *
 *          GET / PUT /v1/admin/ci/policy (`?project_id=` picks the active
 *          app's organization). Owners and admins save; only an owner turns
 *          the no-spend rule off. Members and viewers read it.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import type { CiPolicyResponse } from '../../lib/ciPlacementTypes'
import { draftFromPolicy, parsePolicyDraft, type PolicyDraft } from '../../lib/ciPlacementView'
import { SETTINGS_SECTION_IDS } from '../../lib/settingsTabs'
import { ErrorAlert, Input, ResultChip, Textarea, Toggle } from '../ui'
import { IconLock, IconServer, IconShield } from '../icons'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsList, SettingsRow } from './SettingsRow'

export function CiPolicyCard({ projectId }: { projectId: string | null }) {
  const path = projectId ? `/v1/admin/ci/policy?project_id=${encodeURIComponent(projectId)}` : '/v1/admin/ci/policy'
  const page = usePageData<CiPolicyResponse>(path)
  const [edits, setEdits] = useState<PolicyDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<CiPolicyResponse | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const data = saved ?? page.data
  if (!data) {
    return (
      <SettingsList title="CI policy" id={SETTINGS_SECTION_IDS.ciPolicy}>
        <div className="py-3">
          {page.loading ? (
            <p className="text-sm text-fg-muted">Loading the CI policy…</p>
          ) : (
            <ErrorAlert title="CI policy" message={page.errorMessage ?? page.error ?? 'Could not load the CI policy.'} onRetry={page.reload} />
          )}
        </div>
      </SettingsList>
    )
  }

  const readOnly = !data.canEdit
  const draft = edits ?? draftFromPolicy(data.policy)
  const { body, errors } = parsePolicyDraft(draft)
  const hasErrors = edits !== null && Object.keys(errors).length > 0
  const liftingWithoutOwner = !!data.policy?.noPaidHostedOnPrivate && !draft.noPaidHostedOnPrivate && !data.canLift

  function change<K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) {
    setEdits({ ...draft, [key]: value })
    setSaveError(null)
    setNotice(null)
  }

  async function save() {
    if (!edits || hasErrors || liftingWithoutOwner || !data) return
    setSaving(true)
    const res = await apiFetch<CiPolicyResponse>('/v1/admin/ci/policy', { method: 'PUT', body: JSON.stringify({ organizationId: data.organizationId, ...body }) })
    setSaving(false)
    if (!res.ok || !res.data) {
      setSaveError(res.error?.message ?? 'Mushi did not save the CI policy. Try again in a moment.')
      return
    }
    setSaved(res.data)
    setEdits(null)
    setNotice('Saved. Every new CI placement request is checked against it, and again when it runs.')
    page.reload()
  }

  const disabled = readOnly || !data.writable
  return (
    <div data-testid="ci-policy-card" className="space-y-2">
      <SettingsList
        title="CI policy"
        id={SETTINGS_SECTION_IDS.ciPolicy}
        description="Your CI agreement, as Mushi enforces it when someone asks to change where CI runs. Mushi never fills this in for you: copy it from your agreement."
      >
        {!data.writable && (
          <p className="py-2 text-sm text-fg-muted" data-testid="ci-policy-not-writable">
            Saving becomes possible after the next database update.
          </p>
        )}
        {data.writable && readOnly && (
          <p className="py-2 text-sm text-fg-muted" data-testid="ci-policy-readonly">
            Team owners and admins change the CI policy.
          </p>
        )}
        {data.writable && !data.policy && !readOnly && (
          <p className="py-2 text-sm text-fg-muted">Nothing recorded yet. Import from your CI agreement: fill in the rows below and save.</p>
        )}

        <SettingsRow
          icon={<IconShield size={16} />}
          title="No paid GitHub-hosted minutes on private repos"
          purpose="When on, Mushi refuses any change that would send a private repo's jobs to GitHub-hosted runners, at the request and again when it runs. Only an owner can turn it off."
          action={
            <Toggle
              ariaLabel="No paid GitHub-hosted minutes on private repos"
              checked={draft.noPaidHostedOnPrivate}
              disabled={disabled || (draft.noPaidHostedOnPrivate && !data.canLift && !!data.policy?.noPaidHostedOnPrivate)}
              onChange={(next) => change('noPaidHostedOnPrivate', next)}
            />
          }
        >
          <div className="max-w-xl">
            <Textarea
              label="Repos allowed on GitHub-hosted anyway (one owner/repo per line)"
              rows={2}
              value={draft.hostedAllowedRepos}
              placeholder={'AtPeak-Co-Ltd/pck\nkensaurus/mushi-mushi'}
              disabled={disabled}
              error={edits ? errors.hostedAllowedRepos : undefined}
              onChange={(e) => change('hostedAllowedRepos', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconLock size={16} />}
          title="External controllers"
          purpose="Another tool that decides where some repos' CI runs (a dispatcher that flips labels). Mushi shows those repos read-only and never competes with it."
        >
          <div className="max-w-xl">
            <Textarea
              label="One per line: name | owner | owner/repo, owner/repo"
              rows={2}
              value={draft.externalControllers}
              placeholder="kci dispatcher | sbc-visual | kensaurus/solo-boss-cloud_backend, kensaurus/tsumagoi"
              disabled={disabled}
              error={edits ? errors.externalControllers : undefined}
              onChange={(e) => change('externalControllers', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow icon={<IconServer size={16} />} title="Standby runners" purpose="Runners or labels that are only a fallback. Mushi never sends jobs to them. Use * for any characters.">
          <div className="max-w-xl">
            <Textarea
              label="One runner name or label per line"
              rows={2}
              value={draft.standbyRunners}
              placeholder="kensaurus-local-*"
              disabled={disabled}
              error={edits ? errors.standbyRunners : undefined}
              onChange={(e) => change('standbyRunners', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow title="Where this comes from" purpose="Shown with every refusal, so people know which agreement said no.">
          <div className="max-w-xl">
            <Input label="Source" value={draft.sourceNote} placeholder="CI-AGREEMENT.md, 2026-10-22" disabled={disabled} error={edits ? errors.sourceNote : undefined} onChange={(e) => change('sourceNote', e.target.value)} />
          </div>
        </SettingsRow>
      </SettingsList>
      {liftingWithoutOwner && (
        <p className="text-sm text-danger" role="alert">
          Only an owner can turn off “no paid GitHub-hosted minutes on private repos”.
        </p>
      )}
      {saveError && <ErrorAlert title="Not saved" message={saveError} />}
      {notice && !edits && <ResultChip tone="success">{notice}</ResultChip>}
      {!disabled && (
        <SettingsFormFooter
          dirty={edits !== null}
          saving={saving}
          onSave={() => void save()}
          onDiscard={() => {
            setEdits(null)
            setSaveError(null)
          }}
          blockedReason={hasErrors ? 'Fix the fields marked above first.' : liftingWithoutOwner ? 'Only an owner can turn the no-spend rule off.' : null}
        />
      )}
    </div>
  )
}
