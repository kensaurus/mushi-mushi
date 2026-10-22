/**
 * FILE: apps/admin/src/components/settings/VerifiedMergeCard.tsx
 * PURPOSE: Settings → General → "Verified merge" (Plan 024, ADR 0035; the
 *          `?tab=fixes` link lands here). Mushi merges a cloud agent's pull
 *          request on its own only on proof: a test that fails without the
 *          fix and passes with it, no weakened tests, a small diff, green CI,
 *          and two reviews from different model families that both say merge.
 *
 *          Reads GET and saves PUT /v1/admin/projects/:id/verify-settings
 *          (only the changed fields). Runner labels are suggested from the
 *          /ci runners (GET /v1/admin/ci/overview). The Mushi verify
 *          workflow can be copied (GET …/verify-workflow) or added by a pull
 *          request (POST …/verify-workflow/pr). Viewers see it read-only.
 */

import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useActiveOrgSignal } from '../../lib/activeOrg'
import { knownProjectTeam } from '../../lib/crossTeamProject'
import { resolveActiveOrgRole } from '../../lib/orgPermissions'
import { CHIP_TONE } from '../../lib/chipTone'
import { SETTINGS_SECTION_IDS } from '../../lib/settingsTabs'
import type { CiOverview } from '../../lib/ciTypes'
import type {
  VerifySettingsResponse,
  VerifySettingsValues,
  VerifyWorkflowPrResponse,
  VerifyWorkflowResponse,
} from '../../lib/verifyTypes'
import {
  AUTO_REVERT_CHOICES,
  SECOND_JUDGE_CHOICES,
  VERIFY_BOUNDS,
  defaultSecondJudgeModel,
  draftFromSettings,
  runnerLabelError,
  runnerLabelSuggestions,
  serverFieldErrors,
  validateVerifyDraft,
  valuesFromDraft,
  verifySettingsPatch,
  type VerifyDraft,
  type VerifyErrors,
} from '../../lib/verifyView'
import { Btn, ErrorAlert, Input, ResultChip, SelectField, Textarea, Toggle } from '../ui'
import { IconDiff, IconGithub, IconJudge, IconShield, IconShieldCheck, IconTerminal, IconUndo } from '../icons'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsList, SettingsRow } from './SettingsRow'

/** Where `?tab=fixes` scrolls to. */
const VERIFIED_MERGE_SECTION_ID = SETTINGS_SECTION_IDS.verifiedMerge

const WORKFLOW_PATH = '.github/workflows/mushi-verify.yml'

function valuesOf(s: VerifySettingsResponse): VerifySettingsValues {
  return {
    verified_auto_merge: s.verified_auto_merge,
    verified_auto_merge_daily_limit: s.verified_auto_merge_daily_limit,
    verify_runs_on: s.verify_runs_on,
    verify_test_command: s.verify_test_command,
    verify_max_files: s.verify_max_files,
    verify_max_lines: s.verify_max_lines,
    verify_protected_globs: s.verify_protected_globs,
    verify_second_judge: s.verify_second_judge,
    verify_second_judge_model: s.verify_second_judge_model,
    auto_revert: s.auto_revert,
  }
}

/** The caller's role in the project's team; null while unknown (the server still decides). */
function useProjectRole(projectId: string | null): string | null {
  const activeOrgId = useActiveOrgSignal() || null
  const { data } = usePageData<{ organizations: Array<{ id: string; role: string }> }>('/v1/org', {
    scope: 'none',
  })
  const team = (projectId ? knownProjectTeam(projectId) : null) ?? activeOrgId
  return resolveActiveOrgRole(data?.organizations, team)
}

function isMissingRoute(code: string | null, message: string | null): boolean {
  return /NOT_FOUND/i.test(code ?? '') || /^404\b/.test(message ?? '')
}

export function VerifiedMergeCard({ projectId }: { projectId: string | null }) {
  const base = projectId ? `/v1/admin/projects/${encodeURIComponent(projectId)}` : null
  const settings = usePageData<VerifySettingsResponse>(base ? `${base}/verify-settings` : null)
  const ci = usePageData<CiOverview>(
    projectId ? `/v1/admin/ci/overview?project_id=${encodeURIComponent(projectId)}&days=7` : null,
  )
  const readOnly = useProjectRole(projectId) === 'viewer'

  const [edits, setEdits] = useState<VerifyDraft | null>(null)
  // What a successful save stored, until the reload it triggers lands.
  const [justSaved, setJustSaved] = useState<{
    values: VerifySettingsValues
    stamp: string | null
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState<VerifyErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [labelError, setLabelError] = useState<string | null>(null)
  const [workflowBusy, setWorkflowBusy] = useState<'copy' | 'pr' | null>(null)
  const [workflowNotice, setWorkflowNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const [fallbackYaml, setFallbackYaml] = useState<string | null>(null)
  const [workflowPr, setWorkflowPr] = useState<VerifyWorkflowPrResponse | null>(null)

  if (!projectId) return null

  const data = settings.data
  if (!data) {
    if (settings.loading) {
      return (
        <SettingsList title="Verified merge" id={VERIFIED_MERGE_SECTION_ID}>
          <p className="py-3 text-sm text-fg-muted">Loading verified merge settings…</p>
        </SettingsList>
      )
    }
    if (isMissingRoute(settings.errorCode, settings.errorMessage)) {
      return (
        <SettingsList title="Verified merge" id={VERIFIED_MERGE_SECTION_ID}>
          <p className="py-3 text-sm text-fg-muted">Verified merge becomes available after the next server update.</p>
        </SettingsList>
      )
    }
    return (
      <SettingsList title="Verified merge" id={VERIFIED_MERGE_SECTION_ID}>
        <div className="py-3">
          <ErrorAlert
            title="Verified merge"
            message={settings.errorMessage ?? settings.error ?? 'Could not load the verified merge settings.'}
            onRetry={settings.reload}
          />
        </div>
      </SettingsList>
    )
  }

  const saved = justSaved && justSaved.stamp === settings.lastFetchedAt ? justSaved.values : valuesOf(data)
  const draft = edits ?? draftFromSettings(saved)
  const localErrors = edits ? validateVerifyDraft(edits) : {}
  const errors: VerifyErrors = { ...serverErrors, ...localErrors }
  const patch = edits && Object.keys(localErrors).length === 0 ? verifySettingsPatch(valuesFromDraft(edits), saved) : {}
  const changeCount = Object.keys(patch).length
  const dirty = edits !== null && (changeCount > 0 || Object.keys(localErrors).length > 0)
  const suggestions = runnerLabelSuggestions(ci.data, draft.verify_runs_on)

  function change<K extends keyof VerifyDraft>(key: K, value: VerifyDraft[K]) {
    setEdits({ ...draft, [key]: value })
    setServerErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaveError(null)
    setNotice(null)
  }

  function addLabel(raw: string) {
    const label = raw.trim()
    const problem = runnerLabelError(label, draft.verify_runs_on)
    if (problem) {
      setLabelError(problem)
      return
    }
    change('verify_runs_on', [...draft.verify_runs_on, label])
    setNewLabel('')
    setLabelError(null)
  }

  function onLabelKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addLabel(newLabel)
    }
  }

  function discard() {
    setEdits(null)
    setServerErrors({})
    setSaveError(null)
    setLabelError(null)
  }

  async function save() {
    if (!edits || !base || Object.keys(localErrors).length > 0) return
    if (changeCount === 0) {
      discard()
      return
    }
    setSaving(true)
    const res = await apiFetch<VerifySettingsResponse>(`${base}/verify-settings`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    setSaving(false)
    if (!res.ok) {
      const fields = serverFieldErrors(res.error?.issues)
      setServerErrors(fields)
      setSaveError(
        Object.keys(fields).length > 0
          ? 'Mushi did not save: fix the fields marked above.'
          : (res.error?.message ?? 'Mushi did not save the verified merge settings. Try again in a moment.'),
      )
      return
    }
    const stored = res.data && Array.isArray(res.data.verify_runs_on) ? valuesOf(res.data) : valuesFromDraft(edits)
    setJustSaved({ values: stored, stamp: settings.lastFetchedAt })
    setEdits(null)
    setServerErrors({})
    setNotice('Saved.')
    settings.reload()
  }

  async function copyWorkflow() {
    if (!base) return
    setWorkflowBusy('copy')
    setWorkflowNotice(null)
    setFallbackYaml(null)
    const res = await apiFetch<VerifyWorkflowResponse>(`${base}/verify-workflow`, {
      cache: 'no-store',
    })
    setWorkflowBusy(null)
    const yaml = res.ok ? res.data?.yaml : null
    if (!yaml) {
      setWorkflowNotice({
        ok: false,
        message: res.error?.message ?? 'Mushi could not build the workflow file.',
      })
      return
    }
    const where = res.data?.path ?? WORKFLOW_PATH
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(yaml)
      setWorkflowNotice({ ok: true, message: `Copied. Save it in your repository as ${where}.` })
    } catch {
      setFallbackYaml(yaml)
      setWorkflowNotice({
        ok: true,
        message: `Your browser blocked copying. The file is selected below: copy it and save it as ${where}.`,
      })
    }
  }

  async function openWorkflowPr() {
    if (!base) return
    setWorkflowBusy('pr')
    setWorkflowNotice(null)
    const res = await apiFetchMutate<VerifyWorkflowPrResponse>(`${base}/verify-workflow/pr`, {
      method: 'POST',
    })
    setWorkflowBusy(null)
    if (!res.ok || !res.data?.prUrl) {
      setWorkflowNotice({
        ok: false,
        message: res.error?.message ?? 'Mushi could not open the pull request.',
      })
      return
    }
    setWorkflowPr(res.data)
  }

  const judgeOff = draft.verify_second_judge === 'off'
  const judgeKey = data.secondJudgeKey
  const workflowStatus =
    data.workflowInstalled === true
      ? {
          state: 'working' as const,
          label: 'Installed',
          detail: `${WORKFLOW_PATH} is in your repository.`,
        }
      : data.workflowInstalled === false
        ? {
            state: 'not_connected' as const,
            label: 'Not set up',
            detail: 'Until it is, "Test proves the fix" shows Not set up and Mushi never merges on its own.',
          }
        : {
            state: 'attention' as const,
            label: 'Unknown',
            detail: 'Mushi could not read your repository. Connect GitHub on the Projects page.',
          }

  return (
    <div data-testid="verified-merge-card" className="space-y-2">
      <SettingsList
        title="Verified merge"
        id={VERIFIED_MERGE_SECTION_ID}
        description="Mushi merges an agent's fix by itself only on proof, never on an AI's opinion alone."
      >
        {readOnly && (
          <p className="py-2 text-sm text-fg-muted" data-testid="verified-merge-readonly">
            You are a viewer in this team, so these settings are read-only. An owner, admin or member can change them.
          </p>
        )}

        <SettingsRow
          icon={<IconShieldCheck size={16} />}
          title="Merge proven fixes automatically"
          purpose={
            <>
              When this is on, Mushi squash-merges a cloud agent&apos;s pull request only when every check passes on its
              latest commit: Opus says merge, a second AI from another company says merge, CI is green, a test fails
              without the fix and passes with it, no test was weakened, and the change is small. It never merges a
              report that is already fixed. Off: you merge every fix yourself.
            </>
          }
          status={
            <p className="text-sm text-fg-secondary">
              {draft.verified_auto_merge
                ? `On: up to ${draft.verified_auto_merge_daily_limit || '…'} merges a day for this app.`
                : 'Off: nothing merges without you.'}
            </p>
          }
          action={
            <Toggle
              ariaLabel="Merge proven fixes automatically"
              checked={draft.verified_auto_merge}
              disabled={readOnly || saving}
              onChange={(next) => change('verified_auto_merge', next)}
            />
          }
        >
          <div className="max-w-xs">
            <Input
              label="Most merges a day"
              type="number"
              inputMode="numeric"
              min={VERIFY_BOUNDS.dailyLimit.min}
              max={VERIFY_BOUNDS.dailyLimit.max}
              value={draft.verified_auto_merge_daily_limit}
              disabled={readOnly}
              error={errors.verified_auto_merge_daily_limit}
              onChange={(e) => change('verified_auto_merge_daily_limit', e.target.value)}
              tooltip="Counted per app per day. Merges past the limit wait until tomorrow."
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconTerminal size={16} />}
          title="Where the proof runs"
          purpose="The runner labels the Mushi verify workflow asks for. Pick your own machine's label to run it there instead of on GitHub's."
        >
          <div className="space-y-2">
            <ul className="flex flex-wrap gap-1.5" aria-label="Runner labels">
              {draft.verify_runs_on.map((label) => (
                <li
                  key={label}
                  data-testid={`verify-label-${label}`}
                  className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 font-mono text-xs ${CHIP_TONE.neutral}`}
                >
                  {label}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        change(
                          'verify_runs_on',
                          draft.verify_runs_on.filter((l) => l !== label),
                        )
                      }
                      aria-label={`Remove ${label}`}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                </li>
              ))}
              {draft.verify_runs_on.length === 0 && <li className="text-xs text-fg-muted">No labels yet.</li>}
            </ul>
            {errors.verify_runs_on && (
              <p className="text-2xs text-danger" role="alert">
                {errors.verify_runs_on}
              </p>
            )}
            {!readOnly && suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="verify-label-suggestions">
                <span className="text-xs text-fg-muted">From your CI runners:</span>
                {suggestions.slice(0, 8).map((s) => (
                  <Btn
                    key={s}
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid={`verify-suggest-${s}`}
                    aria-label={`Add ${s}`}
                    onClick={() => addLabel(s)}
                  >
                    <span aria-hidden="true">+</span> {s}
                  </Btn>
                ))}
              </div>
            )}
            {!readOnly && (
              <div className="flex max-w-md flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Add a label"
                    value={newLabel}
                    placeholder="alienware-glot-1"
                    error={labelError ?? undefined}
                    onChange={(e) => {
                      setNewLabel(e.target.value)
                      setLabelError(null)
                    }}
                    onKeyDown={onLabelKey}
                  />
                </div>
                <Btn type="button" size="sm" variant="ghost" className="mt-5" onClick={() => addLabel(newLabel)}>
                  Add
                </Btn>
              </div>
            )}
            <p className="text-2xs text-fg-faint">
              Up to {VERIFY_BOUNDS.runsOnMax} labels: letters, numbers, dots, dashes and underscores.{' '}
              <Link to="/ci" className="text-accent-foreground underline underline-offset-2">
                See your runners
              </Link>
            </p>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconTerminal size={16} />}
          title="Test command"
          purpose="How to run the tests a fix adds or changes. Mushi puts those test files where {files} is."
        >
          <div className="max-w-lg">
            <Input
              label="Command"
              value={draft.verify_test_command}
              placeholder="pnpm vitest run {files}"
              disabled={readOnly}
              maxLength={VERIFY_BOUNDS.testCommandMax + 50}
              className="font-mono"
              error={errors.verify_test_command}
              onChange={(e) => change('verify_test_command', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconDiff size={16} />}
          title="Small change limit"
          purpose="A fix that changes more than this outside its tests waits for you."
        >
          <div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Source files"
              type="number"
              inputMode="numeric"
              min={VERIFY_BOUNDS.maxFiles.min}
              max={VERIFY_BOUNDS.maxFiles.max}
              value={draft.verify_max_files}
              disabled={readOnly}
              error={errors.verify_max_files}
              onChange={(e) => change('verify_max_files', e.target.value)}
            />
            <Input
              label="Changed lines"
              type="number"
              inputMode="numeric"
              min={VERIFY_BOUNDS.maxLines.min}
              max={VERIFY_BOUNDS.maxLines.max}
              value={draft.verify_max_lines}
              disabled={readOnly}
              error={errors.verify_max_lines}
              onChange={(e) => change('verify_max_lines', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconShield size={16} />}
          title="Extra protected files"
          purpose="A fix that touches these waits for you. Deleted tests, removed assertions, skipped tests, CI config and lockfiles always do."
        >
          <div className="max-w-lg">
            <Textarea
              label="Patterns, one per line"
              rows={3}
              value={draft.verify_protected_globs}
              placeholder={'supabase/migrations/**\nsrc/payments/**'}
              disabled={readOnly}
              className="font-mono"
              error={errors.verify_protected_globs}
              onChange={(e) => change('verify_protected_globs', e.target.value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconJudge size={16} />}
          title="Second review"
          purpose="A model from another company reviews the fix after every other check passes, on your own key. It can stop a merge, never start one."
          status={
            <p className="text-sm text-fg-secondary" data-testid="verify-judge-key">
              {judgeOff ? (
                'Off: without a second review, Mushi never merges on its own.'
              ) : judgeKey ? (
                <>
                  <span aria-hidden="true">✓ </span>
                  Uses your {judgeKey.provider} key “{judgeKey.label}”.
                </>
              ) : (
                <>
                  <span aria-hidden="true">! </span>
                  No OpenAI or OpenRouter key, so the second review cannot run and Mushi never merges on its own.{' '}
                  <Link to="/settings?tab=byok" className="text-accent-foreground underline underline-offset-2">
                    Add a key
                  </Link>
                </>
              )}
            </p>
          }
        >
          <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Reviewer"
              value={draft.verify_second_judge}
              disabled={readOnly}
              onChange={(e) => change('verify_second_judge', e.target.value as VerifyDraft['verify_second_judge'])}
            >
              {SECOND_JUDGE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <Input
              label="Model"
              value={draft.verify_second_judge_model}
              placeholder={defaultSecondJudgeModel(draft.verify_second_judge)}
              disabled={readOnly || judgeOff}
              error={errors.verify_second_judge_model}
              onChange={(e) => change('verify_second_judge_model', e.target.value)}
              tooltip="Leave empty for the default."
            />
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconUndo size={16} />}
          title="If a merged fix breaks something"
          purpose="For 72 hours after Mushi merges a fix, it watches CI on the merge, the report, and new reports in the files the fix changed. A revert PR waits for you to merge it."
        >
          <div className="max-w-xs">
            <SelectField
              label="When it breaks"
              value={draft.auto_revert}
              disabled={readOnly}
              onChange={(e) => change('auto_revert', e.target.value as VerifyDraft['auto_revert'])}
            >
              {AUTO_REVERT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<IconGithub size={16} />}
          title="Mushi verify workflow"
          purpose="A GitHub Actions workflow in your repository that runs the fix's tests twice: with the fix they must pass, without it they must fail. It needs no Mushi secret."
          status={workflowStatus}
          action={
            <>
              <Btn
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyWorkflow()}
                disabled={dirty || workflowBusy !== null}
                loading={workflowBusy === 'copy'}
                title={dirty ? 'Save your changes first' : 'Copy the workflow file'}
              >
                Copy workflow
              </Btn>
              {!readOnly && data.workflowInstalled !== true && (
                <Btn
                  type="button"
                  size="sm"
                  onClick={() => void openWorkflowPr()}
                  disabled={dirty || workflowBusy !== null}
                  loading={workflowBusy === 'pr'}
                  title={dirty ? 'Save your changes first' : 'Open a pull request that adds the workflow'}
                >
                  Open a PR that adds it
                </Btn>
              )}
            </>
          }
        >
          {dirty && (
            <p className="text-2xs text-fg-muted">
              Save your changes first: the workflow uses the saved runner labels and test command.
            </p>
          )}
          {!saved.verify_test_command && (
            <p className="text-2xs text-fg-muted">
              Add a test command above so the workflow knows how to run your tests.
            </p>
          )}
          {workflowPr && (
            <p className="text-sm text-fg-secondary" role="status" data-testid="verify-workflow-pr">
              <span aria-hidden="true">✓ </span>
              Pull request{workflowPr.prNumber ? ` #${workflowPr.prNumber}` : ''} opened.{' '}
              <a
                href={workflowPr.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-foreground underline underline-offset-2"
              >
                Open it on GitHub ↗
              </a>
            </p>
          )}
          {workflowNotice && (
            <p
              role="status"
              data-testid="verify-workflow-notice"
              className={`text-sm ${workflowNotice.ok ? 'text-fg-secondary' : 'text-warn'}`}
            >
              <span aria-hidden="true">{workflowNotice.ok ? '✓ ' : '! '}</span>
              {workflowNotice.message}
            </p>
          )}
          {fallbackYaml && (
            <textarea
              readOnly
              aria-label="Mushi verify workflow file"
              value={fallbackYaml}
              rows={10}
              ref={(el) => {
                if (el && document.activeElement !== el) {
                  el.focus()
                  el.select()
                }
              }}
              className="w-full rounded-sm border border-edge-subtle bg-surface-raised p-2 font-mono text-xs text-fg"
            />
          )}
        </SettingsRow>
      </SettingsList>

      {saveError && (
        <p className="text-sm text-danger" role="alert">
          {saveError}
        </p>
      )}
      {notice && !dirty && <ResultChip tone="success">{notice}</ResultChip>}
      {!readOnly && (
        <SettingsFormFooter
          dirty={dirty}
          saving={saving}
          changeCount={changeCount}
          onSave={() => void save()}
          onDiscard={discard}
          blockedReason={Object.keys(localErrors).length > 0 ? 'Fix the fields marked above first.' : null}
        />
      )}
    </div>
  )
}
