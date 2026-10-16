/**
 * MonetizationCard — payments across the team's apps (ADR 0025). For each
 * RevenueCat hub: per app, what it sells (entitlements → products, offerings
 * → packages → products with their store state) and the checks that explain
 * why a purchase would fail, each with its fix. The RevenueCat numbers are
 * context, not a revenue dashboard; RevenueCat stays the record and Mushi
 * never holds balances. A fix with an approved action can be asked for here;
 * it runs only after an owner or admin approves it under Connected sources.
 *
 * Data: GET  /v1/admin/orgs/:orgId/monetization
 *       POST /v1/admin/orgs/:orgId/connector-actions   (ask; nothing runs)
 */

import { useState, type ReactNode } from 'react'
import { Badge, Btn, Callout, CopyButton, DisclosurePanel, Loading, Section } from '../ui'
import { formatRelative } from '../ui/metrics'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { PageLoadError } from '../PageLoadError'
import {
  actionRequest,
  appSummary,
  fixPrompt,
  HEADLINE_METRICS,
  metricText,
  productState,
  RULE_STATE,
  RULE_TITLE,
  type MonetizationAppView,
  type MonetizationFinding,
  type MonetizationHubView,
  type MonetizationResponse,
} from './monetizationView'

export function MonetizationCard({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/monetization`
  const { data, loading, error, reload } = usePageData<MonetizationResponse>(path)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const ask = async (hub: MonetizationHubView, finding: MonetizationFinding, projectId: string | null, key: string) => {
    const body = actionRequest(hub, finding, projectId)
    if (!body) return
    setBusy(key)
    setNotice(null)
    try {
      const res = await apiFetchMutate(`/v1/admin/orgs/${orgId}/connector-actions`, { method: 'POST', body: JSON.stringify(body) })
      setNotice(res.ok
        ? { tone: 'info', text: `Asked. Nothing runs until an owner or admin approves it under Connected sources → Actions.${hub.connector?.canAct ? '' : ' Actions are off for this RevenueCat connector: add its write key there first.'}` }
        : { tone: 'danger', text: actionErrorText(res.error, 'The request was not saved. Try again in a minute.') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Payments across apps">
      <p className="mb-3 text-xs text-fg-muted">
        Read from RevenueCat and the stores once a day. Each item says why a purchase would fail and how to fix it. Mushi never holds balances or changes anything without your approval.
      </p>
      {error && <PageLoadError error={error} resource="payments" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading what each app sells…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && data.hubs.length === 0 && data.outsideHub.length === 0 && (
        <p className="text-sm text-fg-muted">
          No RevenueCat project is connected yet, so nothing here is checked. Add RevenueCat under Connected sources below with a read-only v2 key, then bind each app to the project id.
        </p>
      )}
      {data && (
        <div className="flex flex-col gap-4">
          {data.hubs.map((hub) => (
            <HubBlock key={hub.rcProjectId} hub={hub} busy={busy} onAsk={ask} />
          ))}
          {data.outsideHub.length > 0 && (
            <div className="rounded-md border border-edge-subtle p-3">
              <p className="text-sm font-medium text-fg">Selling outside any RevenueCat project</p>
              <ul className="mt-2 flex flex-col gap-2">
                {data.outsideHub.map((o) => (
                  <FindingRow key={o.projectId} finding={o.finding} />
                ))}
              </ul>
            </div>
          )}
          {data.planned.length > 0 && (
            <p className="text-2xs text-fg-faint">
              Planned, not checked yet: {data.planned.map((id) => RULE_TITLE[id] ?? id).join(', ')} (needs the purchases SDK version from the recipe or ingest).
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

type AskFn = (hub: MonetizationHubView, finding: MonetizationFinding, projectId: string | null, key: string) => void

function HubBlock({ hub, busy, onAsk }: { hub: MonetizationHubView; busy: string | null; onAsk: AskFn }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-edge-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">
          RevenueCat project <code className="font-mono text-xs">{hub.rcProjectId}</code>
          {hub.observedAt && <span className="ml-2 text-xs font-normal text-fg-muted">read {formatRelative(hub.observedAt)}</span>}
        </p>
        <a href={hub.dashboardUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
          Open in RevenueCat ↗
        </a>
      </div>
      {hub.read.state !== 'read' && (
        <Callout tone={hub.read.state === 'error' ? 'danger' : 'warn'}>
          <span role="status">{hub.read.reason}</span>
        </Callout>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4" aria-label="RevenueCat numbers">
        {HEADLINE_METRICS.map((m) => (
          <div key={m.id} className="flex flex-col">
            <dt className="text-fg-muted">{m.label}</dt>
            <dd className="font-medium text-fg">{metricText(hub.metrics, m.id)}</dd>
          </div>
        ))}
      </dl>
      {hub.metrics?.state === 'unknown' && <p className="text-2xs text-fg-faint">Numbers not read: {hub.metrics.reason}</p>}
      <p className="text-xs text-fg-muted">
        {hub.catalog.state === 'read'
          ? <>Compared with the billing catalog in {hub.catalog.source}.</>
          : hub.catalog.state === 'error'
            ? <span className="text-danger">The billing catalog ({hub.catalog.source}) could not be read: {hub.catalog.reason}</span>
            : <>No billing catalog declared. Set <code className="font-mono">links.billing.catalog</code> in the recipe of the repo that holds it to compare against it.</>}
      </p>
      <ul className="flex flex-col gap-2">
        {hub.apps.map((app) => (
          <li key={app.projectId}>
            <AppBlock hub={hub} app={app} busy={busy} onAsk={onAsk} />
          </li>
        ))}
      </ul>
      {hub.unattributed.length > 0 && (
        <div>
          <p className="text-xs font-medium text-fg">Not tied to an app</p>
          <p className="text-2xs text-fg-faint">No product, catalog entry or recipe says which app these belong to.</p>
          <ul className="mt-1 flex flex-col gap-2">
            {hub.unattributed.map((f) => (
              <FindingRow key={`${f.ruleId}:${f.target}`} finding={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AppBlock({ hub, app, busy, onAsk }: { hub: MonetizationHubView; app: MonetizationAppView; busy: string | null; onAsk: AskFn }) {
  const summary = appSummary(app)
  return (
    <DisclosurePanel title={app.name} defaultOpen={summary.tone === 'warnSubtle'} trailing={<Badge tone={summary.tone}>{summary.text}</Badge>}>
      <div className="flex flex-col gap-3 p-3">
        {app.findings.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Why a purchase would fail">
            {app.findings.map((f) => {
              const key = `${app.projectId}:${f.ruleId}:${f.target}`
              return (
                <FindingRow key={key} finding={f}>
                  {f.action && hub.connector && (
                    <Btn size="sm" variant="ghost" loading={busy === key} disabled={busy !== null} onClick={() => onAsk(hub, f, app.projectId, key)}>
                      Ask to fix
                    </Btn>
                  )}
                </FindingRow>
              )
            })}
          </ul>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-fg">Entitlements</p>
            {app.entitlements.length === 0 ? (
              <p className="text-xs text-fg-muted">None tied to this app.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {app.entitlements.map((e) => (
                  <li key={e.lookupKey} className="text-xs">
                    <code className="font-mono text-fg">{e.lookupKey}</code>
                    <Products products={e.products} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-fg">Offerings</p>
            {app.offerings.length === 0 ? (
              <p className="text-xs text-fg-muted">None tied to this app.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {app.offerings.map((o) => (
                  <li key={o.lookupKey} className="text-xs">
                    <code className="font-mono text-fg">{o.lookupKey}</code>
                    {o.isCurrent && <Badge tone="infoSubtle" className="ml-1">current</Badge>}
                    <span className="ml-1 text-fg-faint">{o.hasPaywall ? 'paywall set' : 'no paywall'}</span>
                    {o.packages === null ? (
                      <p className="text-fg-muted">Packages not read yet.</p>
                    ) : (
                      <ul className="ml-3 mt-1 flex flex-col gap-1">
                        {o.packages.map((k) => (
                          <li key={k.id}>
                            <code className="font-mono text-fg-secondary">{k.lookupKey}</code>
                            <Products products={k.products} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DisclosurePanel title="Checks">
          <ul className="flex flex-col gap-1 p-3">
            {app.rules.map((r) => (
              <li key={r.ruleId} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:gap-2">
                <span className="shrink-0 font-medium text-fg">{RULE_TITLE[r.ruleId] ?? r.ruleId}</span>
                <Badge tone={RULE_STATE[r.state].tone}>{RULE_STATE[r.state].label}</Badge>
                <span className="text-fg-muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        </DisclosurePanel>
      </div>
    </DisclosurePanel>
  )
}

function Products({ products }: { products: MonetizationAppView['entitlements'][number]['products'] }) {
  if (products === null) return <span className="ml-1 text-fg-faint">products not read yet</span>
  if (products.length === 0) return <span className="ml-1 text-warn-foreground">no products</span>
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {products.map((p) => {
        const st = productState(p)
        return (
          <Badge key={p.id} tone={st.tone} title={`${p.platform || 'Unknown platform'}: ${st.text}`}>
            {p.platform ? `${p.platform} · ` : ''}{p.storeIdentifier}
          </Badge>
        )
      })}
    </span>
  )
}

function FindingRow({ finding, children }: { finding: MonetizationFinding; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-edge-subtle p-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-fg">
          <Badge tone={finding.severity === 'info' ? 'infoSubtle' : finding.severity === 'error' ? 'dangerSubtle' : 'warnSubtle'} className="mr-1">
            {finding.severity === 'info' ? 'Note' : 'Fix'}
          </Badge>
          {finding.message}
        </p>
        <p className="text-2xs text-fg-muted">{finding.fix}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <CopyButton value={fixPrompt(finding)} label="Copy fix" />
        {children}
      </div>
    </li>
  )
}
