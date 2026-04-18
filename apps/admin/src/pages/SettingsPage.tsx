/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is a focused panel
 *          (general / BYOK / Firecrawl / health / dev tools), URL-driven via
 *          ?tab=… so deep links and the back-button behave correctly.
 */

import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageHelp } from '../components/ui'
import { GeneralPanel } from '../components/settings/GeneralPanel'
import { ByokPanel } from '../components/settings/ByokPanel'
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel'
import { HealthPanel } from '../components/settings/HealthPanel'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'

type TabId = 'general' | 'byok' | 'firecrawl' | 'health' | 'dev'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  { id: 'general', label: 'General', description: 'Notifications, Sentry, LLM model, dedup threshold.' },
  { id: 'byok', label: 'LLM keys (BYOK)', description: 'Anthropic + OpenAI-compatible providers.' },
  { id: 'firecrawl', label: 'Firecrawl', description: 'Optional web research provider.' },
  { id: 'health', label: 'Health & test', description: 'Connection status, SDK reference, pipeline smoke test.' },
  { id: 'dev', label: 'Dev tools', description: 'Debug logging and local-only flags.' },
]

function isTabId(value: string | null): value is TabId {
  return value === 'general' || value === 'byok' || value === 'firecrawl' || value === 'health' || value === 'dev'
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const active: TabId = isTabId(param) ? param : 'general'
  const activeMeta = TABS.find(t => t.id === active) ?? TABS[0]

  const setActive = (id: TabId) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'general') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Project Settings" />

      <PageHelp
        title="About Settings"
        whatIsIt="Tunable knobs for the bug pipeline: which model classifies reports, how strict the dedup threshold is, where to send notifications, and which Sentry feedback to ingest."
        useCases={[
          'Swap in a fine-tuned model once Fine-Tuning produces one',
          'Tighten the confidence threshold to reduce false positives, or loosen it to catch more',
          'Pipe alerts into Slack and Sentry for unified incident response',
        ]}
        howToUse="Save persists changes immediately and writes an audit-log entry. Use Health & test below to verify your config before relying on it in production."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 border-b border-edge-subtle"
      >
        {TABS.map((t) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-panel-${t.id}`}
              id={`settings-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={
                'px-3 py-1.5 text-xs font-medium rounded-t-sm border-b-2 motion-safe:transition-colors ' +
                (selected
                  ? 'border-brand text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg hover:border-edge')
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <p className="text-2xs text-fg-muted">{activeMeta.description}</p>

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
      >
        {active === 'general' && <GeneralPanel />}
        {active === 'byok' && <ByokPanel />}
        {active === 'firecrawl' && <FirecrawlPanel />}
        {active === 'health' && <HealthPanel />}
        {active === 'dev' && <DevToolsPanel />}
      </div>
    </div>
  )
}
