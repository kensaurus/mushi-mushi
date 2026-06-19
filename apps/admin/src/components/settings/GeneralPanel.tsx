/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.tsx
 * PURPOSE: General project knobs — Slack notifications, Sentry forwarding,
 *          LLM pipeline model + thresholds, and dedup similarity.
 *          Loads + persists `/v1/admin/settings` with optimistic save toasts.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { Section, Input, SelectField, ErrorAlert, Checkbox } from '../ui'
import { PanelSkeleton } from '../skeletons/PanelSkeleton'
import { ConfigHelp } from '../ConfigHelp'
import { slackWebhookUrl, sentryDsn, token } from '../../lib/validators'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsPanelLayout } from './SettingsPanelLayout'
import { SettingEffectCallout } from '../FeatureExplainPanel'
import { countChangedFields } from './settingsDiff'
import { ContainedBlock } from '../report-detail/ReportSurface'
import { ConsoleHelpPanel } from '../ConsoleHelpPanel'

interface ProjectSettings {
  slack_webhook_url?: string
  slack_channel_id?: string
  slack_team_id?: string
  sentry_dsn?: string
  sentry_webhook_secret?: string
  sentry_consume_user_feedback?: boolean
  stage2_model?: string
  stage1_confidence_threshold?: number
  dedup_threshold?: number
  embedding_model?: string
  crawl_max_pages_per_day?: number
  crawl_max_runs_per_day?: number
  tdd_max_gens_per_day?: number
  /** Branch name template for fix-worker PRs. Tokens: {date}, {category}, {shortId}. */
  fix_branch_template?: string
}

export function GeneralPanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<ProjectSettings>('/v1/admin/settings')
  const [draft, setDraft] = useState<ProjectSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const saved: ProjectSettings = data ?? {}
  const settings: ProjectSettings = draft ?? saved

  const update = (patch: Partial<ProjectSettings>) =>
    setDraft({ ...settings, ...patch })

  const dirty = draft != null
  const [testingSlack, setTestingSlack] = useState(false)
  const [slackTestResult, setSlackTestResult] = useState<'ok' | 'err' | null>(null)

  async function testSlack() {
    setTestingSlack(true)
    setSlackTestResult(null)
    const res = await apiFetch('/v1/admin/settings/test-slack', { method: 'POST' })
    setTestingSlack(false)
    setSlackTestResult(res.ok ? 'ok' : 'err')
    setTimeout(() => setSlackTestResult(null), 4000)
  }

  const DEFAULT_BRANCH_TEMPLATE = 'mushi/fix/{date}-{category}-{shortId}'
  const changeCount = dirty
    ? countChangedFields([
        { current: settings.slack_webhook_url ?? '', saved: saved.slack_webhook_url ?? '' },
        { current: settings.slack_channel_id ?? '', saved: saved.slack_channel_id ?? '' },
        { current: settings.sentry_dsn ?? '', saved: saved.sentry_dsn ?? '' },
        { current: settings.sentry_webhook_secret ?? '', saved: saved.sentry_webhook_secret ?? '' },
        { current: settings.sentry_consume_user_feedback ?? true, saved: saved.sentry_consume_user_feedback ?? true },
        { current: settings.stage2_model ?? 'claude-sonnet-4-6', saved: saved.stage2_model ?? 'claude-sonnet-4-6' },
        { current: settings.stage1_confidence_threshold ?? 0.85, saved: saved.stage1_confidence_threshold ?? 0.85 },
        { current: settings.dedup_threshold ?? 0.82, saved: saved.dedup_threshold ?? 0.82 },
        { current: settings.crawl_max_pages_per_day ?? 150, saved: saved.crawl_max_pages_per_day ?? 150 },
        { current: settings.crawl_max_runs_per_day ?? 8, saved: saved.crawl_max_runs_per_day ?? 8 },
        { current: settings.tdd_max_gens_per_day ?? 20, saved: saved.tdd_max_gens_per_day ?? 20 },
        { current: settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE, saved: saved.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE },
      ])
    : 0

  async function save() {
    setSaving(true)
    const res = await apiFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Settings saved')
      setDraft(null)
      reload()
    } else {
      toast.error('Failed to save settings', res.error?.message)
    }
  }

  if (loading) return <PanelSkeleton rows={4} label="Loading settings" inCard={false} />
  if (error) return <ErrorAlert message={`Failed to load settings: ${error}`} onRetry={reload} />

  return (
    <>
    <SettingsPanelLayout
      fullWidth={
        <SettingEffectCallout label="Overview">
          Controls where bug alerts go (Slack), whether Sentry errors become reports, and how the AI
          triages and groups similar bugs. Save applies changes to this project only.
        </SettingEffectCallout>
      }
      footer={
        <SettingsFormFooter
          dirty={dirty}
          saving={saving}
          changeCount={changeCount}
          onSave={() => void save()}
          onDiscard={() => setDraft(null)}
        />
      }
    >
      <div id="slack" className="scroll-mt-6">
        <Section title="Bug alerts in Slack" className="space-y-4">
          <SettingEffectCallout>
            When someone submits a bug, Mushi can post to a Slack channel with Triage and Dispatch fix
            buttons. Fix progress replies appear in the same thread when you use the bot (recommended).
          </SettingEffectCallout>
          {/* Bot channel config (preferred — supports threading) */}
          <div className="rounded-md border border-edge-subtle bg-surface-raised/50 p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-fg">Bot notifications</p>
                <p className="text-2xs text-fg-muted mt-0.5">
                  Post to a channel via the Mushi Slack bot. Reports will include <em>Triage →</em> and <em>Dispatch fix</em> buttons, and fix-dispatched status is posted as a threaded reply.
                </p>
              </div>
              {(settings.slack_channel_id || settings.slack_webhook_url) && (
                <button
                  type="button"
                  onClick={() => void testSlack()}
                  disabled={testingSlack}
                  className={`shrink-0 px-2.5 py-1 rounded-sm text-2xs font-medium border transition-colors ${
                    slackTestResult === 'ok'
                      ? 'border-ok bg-ok-muted/50 text-ok-foreground'
                      : slackTestResult === 'err'
                        ? 'border-danger bg-danger-muted text-danger'
                        : 'border-edge-subtle text-fg-muted hover:text-fg'
                  }`}
                >
                  {testingSlack ? 'Sending…' : slackTestResult === 'ok' ? '✓ Sent' : slackTestResult === 'err' ? '✗ Failed' : 'Send test'}
                </button>
              )}
            </div>
            <div>
              <Input
                label="Channel ID"
                helpId="settings.general.slack_channel_id"
                type="text"
                value={settings.slack_channel_id ?? ''}
                onChange={(e) => update({ slack_channel_id: e.target.value.trim() })}
                placeholder="C0B82A322RW"
              />
              <p className="text-fg-faint text-3xs mt-0.5">
                Right-click the channel in Slack → View channel details → Copy channel ID.
                The bot token is set as a Supabase project secret (SLACK_BOT_TOKEN) — not stored here.
              </p>
              <SettingsChangeHint
                current={settings.slack_channel_id ?? ''}
                saved={saved.slack_channel_id ?? ''}
                kind="text"
              />
            </div>
          </div>
          {/* Legacy webhook fallback */}
          <details className="rounded-md border border-edge-subtle">
            <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-3 py-2 text-xs text-fg-muted hover:text-fg hover:bg-surface-overlay rounded-md">
              <span>Incoming Webhook URL <span className="text-3xs text-fg-faint ml-1">(legacy — no threading)</span></span>
              <span aria-hidden className="text-2xs text-fg-faint">›</span>
            </summary>
            <div className="px-3 pb-3 pt-1">
              <Input
                label="Webhook URL"
                helpId="settings.general.slack_webhook_url"
                type="url"
                value={settings.slack_webhook_url ?? ''}
                onChange={(e) => update({ slack_webhook_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                validate={slackWebhookUrl()}
              />
              <SettingsChangeHint
                current={settings.slack_webhook_url ?? ''}
                saved={saved.slack_webhook_url ?? ''}
                kind="url"
              />
            </div>
          </details>
        </Section>
      </div>

      <Section title="Sentry error tracking" className="space-y-3">
        <SettingEffectCallout>
          Connect your Sentry project so production crashes and optional user-feedback widgets become
          Mushi reports — same triage queue as in-app bug reports.
        </SettingEffectCallout>
        <div>
          <Input
            label="Sentry DSN"
            helpId="settings.general.sentry_dsn"
            type="text"
            value={settings.sentry_dsn ?? ''}
            onChange={(e) => update({ sentry_dsn: e.target.value })}
            placeholder="https://abc@o0.ingest.sentry.io/4511023875"
            validate={sentryDsn()}
          />
          <SettingsChangeHint
            current={settings.sentry_dsn ?? ''}
            saved={saved.sentry_dsn ?? ''}
            kind="url"
          />
        </div>
        <div>
          <Input
            label="Webhook Secret"
            helpId="settings.general.sentry_webhook_secret"
            type="password"
            value={settings.sentry_webhook_secret ?? ''}
            onChange={(e) => update({ sentry_webhook_secret: e.target.value })}
            placeholder="Paste from Sentry → Settings → Integrations → Webhook → Client Secret"
            validate={token({ minLength: 16 })}
          />
          <SettingsChangeHint
            current={settings.sentry_webhook_secret ?? ''}
            saved={saved.sentry_webhook_secret ?? ''}
            kind="secret"
          />
        </div>
        <div>
          <Checkbox
            label="Consume Sentry User Feedback as Mushi reports"
            helpId="settings.general.sentry_consume_user_feedback"
            checked={settings.sentry_consume_user_feedback ?? true}
            onChange={(v) => update({ sentry_consume_user_feedback: v })}
          />
          <SettingsChangeHint
            current={settings.sentry_consume_user_feedback ?? true}
            saved={saved.sentry_consume_user_feedback ?? true}
            kind="bool"
          />
        </div>
      </Section>

      <Section title="Triage AI" className="space-y-3">
        <SettingEffectCallout>
          Chooses which AI model scores severity and category when a bug arrives, and how confident
          the fast first pass must be before calling the bigger model.
        </SettingEffectCallout>
        <div>
          <SelectField
            label="Stage 2 Model"
            helpId="settings.general.stage2_model"
            value={settings.stage2_model ?? 'claude-sonnet-4-6'}
            onChange={(e) => update({ stage2_model: e.target.value })}
          >
            <optgroup label="Anthropic (current generation)">
              <option value="claude-opus-4-7">Claude Opus 4.7 — frontier reasoning (2026-Q2)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — recommended default</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — fast / cheap</option>
            </optgroup>
            <optgroup label="OpenAI fallback">
              <option value="gpt-5.4">GPT-5.4</option>
              <option value="gpt-5.4-mini">GPT-5.4-mini</option>
            </optgroup>
            <optgroup label="Legacy (cost review only)">
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
              <option value="gpt-4.1">GPT-4.1</option>
            </optgroup>
          </SelectField>
          <SettingsChangeHint
            current={settings.stage2_model ?? 'claude-sonnet-4-6'}
            saved={saved.stage2_model ?? 'claude-sonnet-4-6'}
          />
        </div>
        <div>
          <Slider
            label="Stage 1 Confidence Threshold"
            helpId="settings.general.stage1_confidence_threshold"
            value={settings.stage1_confidence_threshold ?? 0.85}
            onChange={(v) => update({ stage1_confidence_threshold: v })}
          />
          <SettingsChangeHint
            current={settings.stage1_confidence_threshold ?? 0.85}
            saved={saved.stage1_confidence_threshold ?? 0.85}
            kind="number"
          />
        </div>
      </Section>

      <Section title="Grouping similar bugs" className="space-y-3">
        <SettingEffectCallout>
          Higher = only very similar reports merge into one cluster. Lower = more aggressive grouping
          (fewer duplicate tickets, but unrelated bugs may lump together).
        </SettingEffectCallout>
        <div>
          <Slider
            label="Similarity Threshold"
            helpId="settings.general.dedup_threshold"
            value={settings.dedup_threshold ?? 0.82}
            onChange={(v) => update({ dedup_threshold: v })}
          />
          <SettingsChangeHint
            current={settings.dedup_threshold ?? 0.82}
            saved={saved.dedup_threshold ?? 0.82}
            kind="number"
          />
        </div>
      </Section>

      <Section title="Auto-fix branch names" className="space-y-3">
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            Template for branches opened by the fix-worker. Available tokens:{' '}
            <code className="font-mono text-fg-secondary">{'{'}</code>
            <code className="font-mono text-fg-secondary">date</code>
            <code className="font-mono text-fg-secondary">{'}'}</code>{' '}
            (YYYY-MM-DD),{' '}
            <code className="font-mono text-fg-secondary">{'{'}</code>
            <code className="font-mono text-fg-secondary">category</code>
            <code className="font-mono text-fg-secondary">{'}'}</code>{' '}
            (bug / slow / visual / …),{' '}
            <code className="font-mono text-fg-secondary">{'{'}</code>
            <code className="font-mono text-fg-secondary">shortId</code>
            <code className="font-mono text-fg-secondary">{'}'}</code>{' '}
            (first 8 chars of report UUID).
          </p>
        </ContainedBlock>
        <div>
          <Input
            label="Branch template"
            helpId="settings.general.fix_branch_template"
            type="text"
            value={settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            onChange={(e) => update({ fix_branch_template: e.target.value })}
            placeholder={DEFAULT_BRANCH_TEMPLATE}
          />
          <p className="text-fg-faint text-3xs mt-0.5">
            Example result: <code className="font-mono">{
              (settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE)
                .replace('{date}', new Date().toISOString().slice(0, 10))
                .replace('{category}', 'bug')
                .replace('{shortId}', 'abc12345')
            }</code>
          </p>
          <SettingsChangeHint
            current={settings.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            saved={saved.fix_branch_template ?? DEFAULT_BRANCH_TEMPLATE}
            kind="text"
          />
        </div>
      </Section>

      <Section title="Daily spend limits" className="space-y-3">
        <SettingEffectCallout>
          Safety caps on automated web crawls and test generation per day. When a limit is hit, new
          runs wait until midnight UTC instead of silently running up a bill.
        </SettingEffectCallout>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <label className="block">
            <ContainedBlock tone="muted" className="mb-1">
              <span className="text-2xs text-fg-muted">
                Crawl pages / day:{' '}
                <span className="font-mono text-fg-secondary">{settings.crawl_max_pages_per_day ?? 150}</span>
              </span>
            </ContainedBlock>
            <input
              type="range"
              min="10"
              max="500"
              step="10"
              className="w-full accent-brand"
              value={settings.crawl_max_pages_per_day ?? 150}
              onChange={(e) => update({ crawl_max_pages_per_day: parseInt(e.target.value, 10) })}
            />
            <SettingsChangeHint
              current={settings.crawl_max_pages_per_day ?? 150}
              saved={saved.crawl_max_pages_per_day ?? 150}
              kind="number"
            />
          </label>

          <label className="block">
            <ContainedBlock tone="muted" className="mb-1">
              <span className="text-2xs text-fg-muted">
                Crawl runs / day:{' '}
                <span className="font-mono text-fg-secondary">{settings.crawl_max_runs_per_day ?? 8}</span>
              </span>
            </ContainedBlock>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              className="w-full accent-brand"
              value={settings.crawl_max_runs_per_day ?? 8}
              onChange={(e) => update({ crawl_max_runs_per_day: parseInt(e.target.value, 10) })}
            />
            <SettingsChangeHint
              current={settings.crawl_max_runs_per_day ?? 8}
              saved={saved.crawl_max_runs_per_day ?? 8}
              kind="number"
            />
          </label>

          <label className="block">
            <ContainedBlock tone="muted" className="mb-1">
              <span className="text-2xs text-fg-muted">
                TDD generations / day:{' '}
                <span className="font-mono text-fg-secondary">{settings.tdd_max_gens_per_day ?? 20}</span>
              </span>
            </ContainedBlock>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              className="w-full accent-brand"
              value={settings.tdd_max_gens_per_day ?? 20}
              onChange={(e) => update({ tdd_max_gens_per_day: parseInt(e.target.value, 10) })}
            />
            <SettingsChangeHint
              current={settings.tdd_max_gens_per_day ?? 20}
              saved={saved.tdd_max_gens_per_day ?? 20}
              kind="number"
            />
          </label>
        </div>
      </Section>
    </SettingsPanelLayout>
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

function Slider({ label, value, onChange, helpId }: SliderProps) {
  return (
    <label className="block">
      <ContainedBlock tone="muted" className="mb-1">
        <span className="text-xs text-fg-muted flex items-center gap-1">
          <span>
            {label}: <span className="font-mono text-fg-secondary">{value.toFixed(2)}</span>
          </span>
          {helpId && <ConfigHelp helpId={helpId} />}
        </span>
      </ContainedBlock>
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
