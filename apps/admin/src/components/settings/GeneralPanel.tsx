/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.tsx
 * PURPOSE: Settings → General. Lists, one card each:
 *            Bug alerts       Slack bot channel, older Slack webhook
 *            Error tracking   Sentry
 *            Your database    Supabase project link (read-only)
 *            Bug sorting      triage model, confidence, grouping, fix branches
 *            Daily limits     crawl pages / runs, test generations
 *            Feedback widget  "Bug reports by Mushi" line
 *          Loads + saves `/v1/admin/settings`; secrets come back masked with
 *          a `<column>_set` flag and are never sent back. The Slack row's
 *          "can send" state also reads `slackCanPost` from settings stats
 *          (passed in) plus the row's own channel, webhook, and bot flags.
 */

import { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Btn, Input, SecretInput, SelectField, ErrorAlert, Checkbox, ResultChip } from '../ui'
import { ClaudeModelSelect } from './ClaudeModelSelect'
import { SettingDefaultActions } from './SettingDefaultActions'
import { effectiveModelId } from '../../lib/claudeModels'
import { BrandIcon } from '../ui/BrandIcon'
import { IconGit, IconGauge, IconJudge, IconCost, IconChat } from '../icons'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfigHelp } from '../ConfigHelp'
import {
  fixBranchExample,
  fixBranchTemplate,
  slackWebhookUrl,
  sentryDsn,
  supabaseProjectRef,
  token,
} from '../../lib/validators'
import { LINK_ACCENT } from '../../lib/chipTone'
import { usePersistentState } from '../../lib/usePersistentState'
import { getActiveProjectIdSnapshot } from '../../lib/activeProject'
import { useEntitlements } from '../../lib/useEntitlements'
import { SettingsChangeHint } from './SettingsChangeHint'
import { StoredSecretStatus } from './StoredSecretStatus'
import { SettingsFormFooter } from './SettingsFormFooter'
import { changedSettings, countChangedFields, settingsFormBase } from './settingsDiff'
import { ConsoleHelpPanel } from '../ConsoleHelpPanel'
import { LifecycleEmailsToggle } from './LifecycleEmailsToggle'
import { useByokPool } from './ByokPoolContext'
import { providerStatusView } from './keyStatus'
import { SettingsList, SettingsRow, type RowStatusValue } from './SettingsRow'
import { slackAlertStatus, slackCanOfferTest } from './slackAlertStatus'
import { fixBranchFieldState } from './fixBranchField'
import { sentryRowStatus, useSentryConnection } from '../../lib/useSentryConnection'
import type { HealthRow } from '../integrations/types'

/** Tri-state select values for `widget_brand_footer` (null = plan default). */
type BrandFooterChoice = 'default' | 'on' | 'off'

function brandFooterToChoice(value: boolean | null | undefined): BrandFooterChoice {
  if (value === true) return 'on'
  if (value === false) return 'off'
  return 'default'
}

function choiceToBrandFooter(choice: BrandFooterChoice): boolean | null {
  if (choice === 'on') return true
  if (choice === 'off') return false
  return null
}

interface ProjectSettings {
  slack_webhook_url?: string
  slack_channel_id?: string
  slack_team_id?: string
  sentry_dsn?: string
  sentry_webhook_secret?: string
  /** Server flags beside masked secrets: the value itself never reaches the console. */
  sentry_webhook_secret_set?: boolean
  slack_webhook_url_set?: boolean
  /** True when this project's Slack bot token is stored. The token itself never arrives. */
  slack_bot_token_ref_set?: boolean
  sentry_consume_user_feedback?: boolean
  stage2_model?: string
  /** Quick check (Stage 1) model. Claude ids only; the server rejects others. */
  stage1_model?: string
  /** Model that grades the triage on /judge. Claude ids only. */
  judge_model?: string
  /** Model Mushi's own fix agent writes fixes with. Claude ids only. */
  claude_default_model?: string
  stage1_confidence_threshold?: number
  dedup_threshold?: number
  embedding_model?: string
  crawl_max_pages_per_day?: number
  crawl_max_runs_per_day?: number
  tdd_max_gens_per_day?: number
  /** Branch name template for fix-worker PRs: <type>/MUSHI-{reportId}-… plus {category}, {date}, {shortId}. */
  fix_branch_template?: string
  /** "Bug reports by Mushi" mark on the feedback widget. `null`/absent =
   *  plan default (on for Free Cloud, off for paid and self-host). */
  widget_brand_footer?: boolean | null
  /** Linked Supabase project (20-char ref). The token is a key under AI keys. */
  supabase_project_ref?: string | null
}

/** Where a scoped Supabase access token is created. */
const SUPABASE_TOKENS_URL = 'https://supabase.com/dashboard/account/tokens'
const DEFAULT_BRANCH_TEMPLATE = 'bugfix/MUSHI-{reportId}-{category}'
/** The model each job really runs: column defaults and retired ids resolve like the server does. */
const eff = effectiveModelId

export function GeneralPanel({ slackCanPost }: { slackCanPost?: boolean }) {
  const toast = useToast()
  const entitlements = useEntitlements()
  const { data, loading, error, reload } = usePageData<ProjectSettings>('/v1/admin/settings')
  const pool = useByokPool(!entitlements.loading && entitlements.has('byok'))
  // The same verdict the Integrations card shows, from the same inputs, so
  // the two pages never disagree about Sentry.
  const sentryShared = useSentryConnection()
  // The Slack probe the Integrations card reads (same request, cached), so a
  // test sent from either page shows on both.
  const health = usePageData<{ history: HealthRow[] }>('/v1/admin/health/history')
  const slackProbe = health.data?.history?.find((h) => h.kind === 'slack')
  const [draft, setDraft] = useState<ProjectSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [showLegacyWebhook, setShowLegacyWebhook] = usePersistentState(
    'settings:general:slack-webhook-open',
    false,
    { projectId: getActiveProjectIdSnapshot(), validate: (v): v is boolean => typeof v === 'boolean' },
  )
  // The four model pickers were about 340 words a new user scrolled past on
  // a ~2,600-word tab; the defaults work, so they wait behind one row
  // (integrator's new-user walk, 2026-10-28).
  const [showModels, setShowModels] = usePersistentState(
    'settings:general:models-open',
    false,
    { projectId: getActiveProjectIdSnapshot(), validate: (v): v is boolean => typeof v === 'boolean' },
  )

  // Masked secrets start empty in the form; their `_set` flags say whether one is stored.
  const saved: ProjectSettings = useMemo(() => settingsFormBase(data), [data])
  const settings: ProjectSettings = draft ?? saved

  const update = (patch: Partial<ProjectSettings>) => setDraft({ ...settings, ...patch })

  const dirty = draft != null
  const [testingSlack, setTestingSlack] = useState(false)
  const [slackTest, setSlackTest] = useState<{ ok: boolean; at: string } | null>(null)

  async function testSlack() {
    setTestingSlack(true)
    const res = await apiFetch('/v1/admin/settings/test-slack', { method: 'POST' })
    setTestingSlack(false)
    setSlackTest({ ok: res.ok, at: new Date().toISOString() })
  }

  const changeCount = dirty
    ? countChangedFields([
        { current: settings.slack_webhook_url ?? '', saved: saved.slack_webhook_url ?? '' },
        { current: settings.slack_channel_id ?? '', saved: saved.slack_channel_id ?? '' },
        { current: settings.sentry_dsn ?? '', saved: saved.sentry_dsn ?? '' },
        { current: settings.sentry_webhook_secret ?? '', saved: saved.sentry_webhook_secret ?? '' },
        { current: settings.sentry_consume_user_feedback ?? true, saved: saved.sentry_consume_user_feedback ?? true },
        { current: eff(settings.stage2_model, 'diagnosis'), saved: eff(saved.stage2_model, 'diagnosis') },
        { current: eff(settings.stage1_model, 'quick_check'), saved: eff(saved.stage1_model, 'quick_check') },
        { current: eff(settings.judge_model, 'judge'), saved: eff(saved.judge_model, 'judge') },
        { current: eff(settings.claude_default_model, 'fix'), saved: eff(saved.claude_default_model, 'fix') },
        { current: settings.stage1_confidence_threshold ?? 0.85, saved: saved.stage1_confidence_threshold ?? 0.85 },
        { current: settings.dedup_threshold ?? 0.82, saved: saved.dedup_threshold ?? 0.82 },
        { current: settings.crawl_max_pages_per_day ?? 150, saved: saved.crawl_max_pages_per_day ?? 150 },
        { current: settings.crawl_max_runs_per_day ?? 8, saved: saved.crawl_max_runs_per_day ?? 8 },
        { current: settings.tdd_max_gens_per_day ?? 20, saved: saved.tdd_max_gens_per_day ?? 20 },
        { current: settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE, saved: saved.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE },
        { current: settings.supabase_project_ref ?? '', saved: saved.supabase_project_ref ?? '' },
        { current: brandFooterToChoice(settings.widget_brand_footer), saved: brandFooterToChoice(saved.widget_brand_footer) },
      ])
    : 0

  async function save() {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(changedSettings(settings, saved)),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Settings saved')
      setDraft(null)
      reload()
    } else {
      toast.error('Your settings were not saved', res.error?.message)
    }
  }

  if (loading) return <PanelSkeleton rows={4} label="Loading settings" inCard={false} />
  if (error) return <ErrorAlert message={`Couldn't load your settings: ${error}`} onRetry={reload} />

  // ── Statuses: what is saved, and what Mushi has actually confirmed ──────────
  // A channel id alone cannot post. slackCanPost covers an org or operator
  // bot that this project's settings row does not list.
  const slackInput = {
    channelId: saved.slack_channel_id,
    webhookSet: saved.slack_webhook_url_set === true,
    botSet: saved.slack_bot_token_ref_set === true,
    canPost: slackCanPost,
    tested: slackTest,
    probe: slackProbe,
  }
  const slackStatus: RowStatusValue = slackAlertStatus(slackInput)
  const canTestSlack = slackCanOfferTest(slackInput)

  // What this page alone can see: a DSN and a webhook secret are saved, or
  // they are not. It is never a verdict — Sentry can be connected and
  // delivering with its org slug and auth token, which live on Integrations.
  const sentryDsnSaved = Boolean(saved.sentry_dsn)
  const sentrySavedHint: RowStatusValue = !sentryDsnSaved
    ? { state: 'not_connected', detail: 'Add your Sentry DSN to turn production errors into reports.' }
    : saved.sentry_webhook_secret_set !== true
      ? { state: 'attention', detail: "Add the webhook secret below, or Mushi can't accept Sentry's deliveries." }
      : { state: 'checking', detail: 'Saved. The Integrations page shows when Sentry sends its first error.' }
  // The shared verdict wins once the credentials and probes have been read;
  // the saved-value line fills in a detail the verdict leaves empty, and
  // stands in while there is nothing to check (no Sentry credentials yet).
  const sentryStatus: RowStatusValue = sentryRowStatus(sentryShared, sentrySavedHint)

  const supabaseRefSaved = Boolean(saved.supabase_project_ref)
  const supabaseKeyView = providerStatusView('supabase', pool.data?.keys ?? [], pool.data?.legacyKeys ?? [], {
    providerName: 'Supabase',
    emptyDetail: 'Add a read-only token under AI keys → Supabase.',
  })
  const supabaseStatus: RowStatusValue = !supabaseRefSaved
    ? { state: 'not_connected', detail: 'Save your project ref below, then add a read-only token under AI keys.' }
    : supabaseKeyView

  const branchExample = fixBranchExample(settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE)
  const branch = fixBranchFieldState({
    current: settings.fix_branch_template,
    saved: saved.fix_branch_template,
    defaultValue: DEFAULT_BRANCH_TEMPLATE,
  })

  return (
    <>
      <SettingsList
        id="slack"
        title="Bug alerts"
        description="Where Mushi tells you about new bugs."
      >
        <SettingsRow
          icon={<BrandIcon brand="slack" size={18} decorative />}
          title="Slack channel"
          purpose="Posts each new bug with Triage and Fix buttons. Fix progress replies in the same thread."
          status={slackStatus}
          action={
            canTestSlack ? (
              <Btn size="sm" variant="ghost" loading={testingSlack} onClick={() => void testSlack()}>
                Send test message
              </Btn>
            ) : null
          }
        >
          <Input
            label="Channel ID"
            helpId="settings.general.slack_channel_id"
            type="text"
            value={settings.slack_channel_id ?? ''}
            onChange={(e) => update({ slack_channel_id: e.target.value.trim() })}
            // An empty field showing a real-looking ID read as already filled in (2026-10-28).
            placeholder="e.g. C0123ABCDEF"
          />
          <p className="text-xs text-fg-muted">
            {slackInput.botSet || slackCanPost
              ? "In Slack, open the channel's details and copy the channel ID at the bottom. Then invite the Mushi bot to the channel."
              : "Mushi's Slack bot isn't connected to this app, so a channel ID alone can't post. Connect it on Integrations, or use the webhook below."}
          </p>
          <SettingsChangeHint current={settings.slack_channel_id ?? ''} saved={saved.slack_channel_id ?? ''} kind="text" />
          {slackTest && (
            <ResultChip tone={slackTest.ok ? 'success' : 'error'} at={slackTest.at}>
              {slackTest.ok ? 'Test message sent' : 'Test message failed'}
            </ResultChip>
          )}
        </SettingsRow>

        <SettingsRow
          icon={<IconChat size={16} />}
          title="Older Slack webhook"
          purpose="A simpler way to post alerts, without threads or buttons. Use the channel above if you can."
          status={
            saved.slack_webhook_url_set
              ? { state: 'checking', detail: 'Saved.' }
              : { state: 'not_connected', detail: 'Not used.' }
          }
          action={
            <Btn
              size="sm"
              variant="ghost"
              aria-expanded={showLegacyWebhook}
              onClick={() => setShowLegacyWebhook(!showLegacyWebhook)}
            >
              {showLegacyWebhook ? 'Hide' : saved.slack_webhook_url_set ? 'Change' : 'Set up'}
            </Btn>
          }
        >
          {showLegacyWebhook ? (
            <>
              <SecretInput
                label="Webhook URL"
                helpId="settings.general.slack_webhook_url"
                value={settings.slack_webhook_url ?? ''}
                onChange={(e) => update({ slack_webhook_url: e.target.value })}
                placeholder={
                  saved.slack_webhook_url_set
                    ? 'Saved. Paste a new URL to replace it.'
                    : 'https://hooks.slack.com/services/...'
                }
                validate={slackWebhookUrl()}
              />
              <SettingsChangeHint current={settings.slack_webhook_url ?? ''} saved={saved.slack_webhook_url ?? ''} kind="url" />
              <StoredSecretStatus
                column="slack_webhook_url"
                label="Slack webhook URL"
                isSet={saved.slack_webhook_url_set === true}
                consequence="Bug alerts stop posting through this webhook. The Slack channel above is not affected."
                onRemoved={reload}
              />
            </>
          ) : null}
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Error tracking" description="Bring errors your monitoring already catches into the same bug list.">
        <SettingsRow
          icon={<BrandIcon brand="sentry" size={18} decorative />}
          title="Sentry"
          purpose="Turns production errors and Sentry user feedback into Mushi reports."
          status={sentryStatus}
        >
          {/* The DSN carries the public key; mask it like the webhook secret below. */}
          <SecretInput
            label="Sentry DSN"
            helpId="settings.general.sentry_dsn"
            value={settings.sentry_dsn ?? ''}
            onChange={(e) => update({ sentry_dsn: e.target.value })}
            placeholder="e.g. https://<key>@o0.ingest.sentry.io/<project-id>"
            validate={sentryDsn()}
          />
          <SettingsChangeHint current={settings.sentry_dsn ?? ''} saved={saved.sentry_dsn ?? ''} kind="secret" />
          <SecretInput
            label="Webhook secret"
            helpId="settings.general.sentry_webhook_secret"
            value={settings.sentry_webhook_secret ?? ''}
            onChange={(e) => update({ sentry_webhook_secret: e.target.value })}
            placeholder={
              saved.sentry_webhook_secret_set
                ? 'Saved. Paste a new secret to replace it.'
                : 'From Sentry → Settings → Integrations → your integration → Client Secret'
            }
            validate={token({ minLength: 16 })}
          />
          <SettingsChangeHint current={settings.sentry_webhook_secret ?? ''} saved={saved.sentry_webhook_secret ?? ''} kind="secret" />
          <StoredSecretStatus
            column="sentry_webhook_secret"
            label="Sentry webhook secret"
            isSet={saved.sentry_webhook_secret_set === true}
            consequence="Mushi rejects Sentry deliveries until you paste a new secret."
            onRemoved={reload}
          />
          <Checkbox
            label="Also turn Sentry user feedback into reports"
            helpId="settings.general.sentry_consume_user_feedback"
            checked={settings.sentry_consume_user_feedback ?? true}
            onChange={(v) => update({ sentry_consume_user_feedback: v })}
          />
          <SettingsChangeHint
            current={settings.sentry_consume_user_feedback ?? true}
            saved={saved.sentry_consume_user_feedback ?? true}
            kind="bool"
          />
        </SettingsRow>
      </SettingsList>

      <SettingsList id="supabase" title="Your database" description="Optional. Lets diagnoses see your app's database, read-only.">
        <SettingsRow
          icon={<BrandIcon brand="supabase" size={18} decorative />}
          title="Supabase project"
          purpose="Diagnoses can read its schema, advisors, edge functions and logs. Mushi never writes to it."
          status={supabaseStatus}
          action={
            <Btn size="sm" variant="ghost" to="/settings?tab=byok#key-supabase">
              {supabaseKeyView.state === 'not_connected' ? 'Add token' : 'Manage token'}
            </Btn>
          }
        >
          <Input
            label="Supabase project ref"
            helpId="settings.general.supabase_project_ref"
            type="text"
            value={settings.supabase_project_ref ?? ''}
            onChange={(e) => update({ supabase_project_ref: e.target.value.trim() })}
            placeholder="e.g. abcdefghijklmnopqrst"
            autoComplete="off"
            spellCheck={false}
            validate={supabaseProjectRef()}
          />
          <p className="text-xs text-fg-muted">
            The 20 characters in https://&lt;ref&gt;.supabase.co. Then create a scoped token at{' '}
            <a href={SUPABASE_TOKENS_URL} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT}>
              supabase.com/dashboard/account/tokens
            </a>
            : this project only, Read access to Database, Edge Functions, Advisors and Logs, and an expiry date.
          </p>
          <SettingsChangeHint current={settings.supabase_project_ref ?? ''} saved={saved.supabase_project_ref ?? ''} kind="text" />
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Bug sorting" description="How the AI scores, groups and fixes incoming bugs.">
        <SettingsRow
          icon={<IconJudge size={16} />}
          title="AI models"
          purpose="Mushi picks a model for each job. Change one only to trade cost for quality."
          action={
            <Btn size="sm" variant="ghost" aria-expanded={showModels} onClick={() => setShowModels(!showModels)}>
              {showModels ? 'Hide models' : 'Change models'}
            </Btn>
          }
        />
        {showModels ? (
          <>
            <SettingsRow
              icon={<IconJudge size={16} />}
              title="Triage model"
              purpose="The AI model that decides each bug's severity and category."
            >
              <ClaudeModelSelect
                role="diagnosis"
                helpId="settings.general.stage2_model"
                value={settings.stage2_model}
                onChange={(id) => update({ stage2_model: id })}
                extraOptions={
                  <optgroup label="OpenAI fallback">
                    <option value="gpt-5.4">GPT-5.4</option>
                    <option value="gpt-5.4-mini">GPT-5.4-mini</option>
                    <option value="gpt-4.1">GPT-4.1 (legacy)</option>
                  </optgroup>
                }
              />
              <SettingsChangeHint current={eff(settings.stage2_model, 'diagnosis')} saved={eff(saved.stage2_model, 'diagnosis')} />
            </SettingsRow>
            <SettingsRow
              icon={<IconCost size={16} />}
              title="Quick check model"
              purpose="The fast first pass that sorts easy bugs and filters noise before the triage model."
            >
              <ClaudeModelSelect
                role="quick_check"
                helpId="settings.general.stage1_model"
                value={settings.stage1_model}
                onChange={(id) => update({ stage1_model: id })}
              />
              <SettingsChangeHint current={eff(settings.stage1_model, 'quick_check')} saved={eff(saved.stage1_model, 'quick_check')} />
            </SettingsRow>
            <SettingsRow
              icon={<IconJudge size={16} />}
              title="Judge model"
              purpose="The model that double-checks a sample of triage results on the Judge page."
            >
              <ClaudeModelSelect
                role="judge"
                helpId="settings.general.judge_model"
                value={settings.judge_model}
                onChange={(id) => update({ judge_model: id })}
              />
              <SettingsChangeHint current={eff(settings.judge_model, 'judge')} saved={eff(saved.judge_model, 'judge')} />
            </SettingsRow>
            <SettingsRow
              icon={<IconGit size={16} />}
              title="Fix model"
              purpose="The model Mushi's own fix agent writes fixes with. Fixes cost the most of any AI call."
            >
              <ClaudeModelSelect
                role="fix"
                helpId="settings.general.fix_model"
                value={settings.claude_default_model}
                onChange={(id) => update({ claude_default_model: id })}
              />
              <SettingsChangeHint current={eff(settings.claude_default_model, 'fix')} saved={eff(saved.claude_default_model, 'fix')} />
            </SettingsRow>
          </>
        ) : null}
        <SettingsRow
          icon={<IconGauge size={16} />}
          title="Quick check confidence"
          purpose="A fast first pass sorts the easy bugs. Below this confidence, the triage model above takes a second look."
        >
          <Slider
            label="Confidence needed"
            helpId="settings.general.stage1_confidence_threshold"
            value={settings.stage1_confidence_threshold ?? 0.85}
            onChange={(v) => update({ stage1_confidence_threshold: v })}
          />
          <SettingDefaultActions
            id="stage1-confidence"
            current={settings.stage1_confidence_threshold ?? 0.85}
            defaultValue={0.85}
            onApply={(v) => update({ stage1_confidence_threshold: v })}
          />
          <SettingsChangeHint
            current={settings.stage1_confidence_threshold ?? 0.85}
            saved={saved.stage1_confidence_threshold ?? 0.85}
            kind="number"
          />
        </SettingsRow>
        <SettingsRow
          icon={<IconGauge size={16} />}
          title="Grouping similar bugs"
          purpose="Higher: only near-identical reports merge. Lower: fewer duplicates, but unrelated bugs may end up together."
        >
          <Slider
            label="Similarity needed"
            helpId="settings.general.dedup_threshold"
            value={settings.dedup_threshold ?? 0.82}
            onChange={(v) => update({ dedup_threshold: v })}
          />
          <SettingDefaultActions
            id="dedup"
            current={settings.dedup_threshold ?? 0.82}
            defaultValue={0.82}
            onApply={(v) => update({ dedup_threshold: v })}
          />
          <SettingsChangeHint current={settings.dedup_threshold ?? 0.82} saved={saved.dedup_threshold ?? 0.82} kind="number" />
        </SettingsRow>
        <SettingsRow
          icon={<IconGit size={16} />}
          title="Fix branch names"
          purpose={
            <>
              The name of each branch Mushi opens for a fix. It must start with a type and{' '}
              <code className="font-mono">{'MUSHI-{reportId}-'}</code>; after that you can use{' '}
              <code className="font-mono">{'{category}'}</code>, <code className="font-mono">{'{date}'}</code>,{' '}
              <code className="font-mono">{'{shortId}'}</code> and lowercase words.
            </>
          }
        >
          <Input
            label="Branch name pattern"
            helpId="settings.general.fix_branch_template"
            type="text"
            value={settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            onChange={(e) => update({ fix_branch_template: e.target.value })}
            placeholder={DEFAULT_BRANCH_TEMPLATE}
            validate={fixBranchTemplate()}
            error={branch.error ?? undefined}
          />
          <p className="text-xs text-fg-muted">
            Example: <code className="font-mono">{branchExample}</code>
          </p>
          <SettingDefaultActions
            id="fix-branch"
            current={settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            defaultValue={DEFAULT_BRANCH_TEMPLATE}
            onApply={(v) => update({ fix_branch_template: v })}
          />
          <SettingsChangeHint
            current={settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            saved={saved.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            kind="text"
          />
        </SettingsRow>
      </SettingsList>

      <SettingsList
        title="Daily limits"
        description="Caps on automatic work each day. When one is reached, new runs wait until midnight UTC instead of running up a bill."
      >
        <SettingsRow icon={<IconCost size={16} />} title="Web pages read per day" purpose="Pages Firecrawl may read across all crawls.">
          <RangeField
            label="Pages per day"
            min={10}
            max={500}
            step={10}
            value={settings.crawl_max_pages_per_day ?? 150}
            onChange={(v) => update({ crawl_max_pages_per_day: v })}
          />
          <SettingDefaultActions
            id="crawl-pages"
            current={settings.crawl_max_pages_per_day ?? 150}
            defaultValue={150}
            onApply={(v) => update({ crawl_max_pages_per_day: v })}
          />
          <SettingsChangeHint current={settings.crawl_max_pages_per_day ?? 150} saved={saved.crawl_max_pages_per_day ?? 150} kind="number" />
        </SettingsRow>
        <SettingsRow icon={<IconCost size={16} />} title="Crawls per day" purpose="How many separate crawls of your app may start.">
          <RangeField
            label="Crawls per day"
            min={1}
            max={50}
            step={1}
            value={settings.crawl_max_runs_per_day ?? 8}
            onChange={(v) => update({ crawl_max_runs_per_day: v })}
          />
          <SettingDefaultActions
            id="crawl-runs"
            current={settings.crawl_max_runs_per_day ?? 8}
            defaultValue={8}
            onApply={(v) => update({ crawl_max_runs_per_day: v })}
          />
          <SettingsChangeHint current={settings.crawl_max_runs_per_day ?? 8} saved={saved.crawl_max_runs_per_day ?? 8} kind="number" />
        </SettingsRow>
        <SettingsRow icon={<IconCost size={16} />} title="Tests written per day" purpose="How many browser tests Mushi may write from your user stories.">
          <RangeField
            label="Tests per day"
            min={1}
            max={100}
            step={1}
            value={settings.tdd_max_gens_per_day ?? 20}
            onChange={(v) => update({ tdd_max_gens_per_day: v })}
          />
          <SettingDefaultActions
            id="tdd-gens"
            current={settings.tdd_max_gens_per_day ?? 20}
            defaultValue={20}
            onApply={(v) => update({ tdd_max_gens_per_day: v })}
          />
          <SettingsChangeHint current={settings.tdd_max_gens_per_day ?? 20} saved={saved.tdd_max_gens_per_day ?? 20} kind="number" />
        </SettingsRow>
      </SettingsList>

      <SettingsList id="widget" title="Feedback widget" description="The bug-report button inside your app.">
        <SettingsRow
          icon={<IconChat size={16} />}
          title="“Bug reports by Mushi” line"
          purpose="A small line at the foot of the widget that links to Mushi. On by default for Free Cloud, off for paid and self-hosted."
        >
          <SelectField
            label="Show the line"
            id="widget-brand-footer"
            value={brandFooterToChoice(settings.widget_brand_footer)}
            onChange={(e) => update({ widget_brand_footer: choiceToBrandFooter(e.target.value as BrandFooterChoice) })}
          >
            <option value="default">Plan default (on for Free Cloud, off for paid and self-host)</option>
            <option value="on">Always show</option>
            <option value="off">Never show</option>
          </SelectField>
          <SettingsChangeHint
            current={brandFooterToChoice(settings.widget_brand_footer)}
            saved={brandFooterToChoice(saved.widget_brand_footer)}
            kind="text"
          />
        </SettingsRow>
      </SettingsList>

      <SettingsFormFooter
        dirty={dirty}
        saving={saving}
        changeCount={changeCount}
        onSave={() => void save()}
        onDiscard={() => setDraft(null)}
        blockedReason={branch.blocksSave ? `Fix the branch name pattern first. ${branch.error}` : null}
      />

      {/* Account-scoped; saves on toggle, independent of the project form above. */}
      <LifecycleEmailsToggle />
      <ConsoleHelpPanel />
    </>
  )
}

interface SliderProps {
  label: string
  value: number
  onChange: (v: number) => void
  /** Optional id into `apps/admin/src/lib/configDocs.ts`. */
  helpId?: string
}

/** 0.50–0.99 threshold slider, shown as a percentage. */
function Slider({ label, value, onChange, helpId }: SliderProps) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-sm text-fg-secondary">
        {label}: <span className="font-mono text-fg">{Math.round(value * 100)}%</span>
        {helpId && <ConfigHelp helpId={helpId} />}
      </span>
      <input
        type="range"
        min="0.5"
        max="0.99"
        step="0.01"
        className="w-full accent-brand"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-fg-secondary">
        {label}: <span className="font-mono text-fg">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        className="w-full accent-brand"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </label>
  )
}
