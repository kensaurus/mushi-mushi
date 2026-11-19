/**
 * MonetizationCard — payments across the team's apps (ADR 0025). For each
 * RevenueCat hub: per app, what it sells (entitlements → products, offerings
 * → packages → products with their store state) and the checks that explain
 * why a purchase would fail, each with its fix. The RevenueCat numbers are
 * context, not a revenue dashboard; RevenueCat stays the record and Mushi
 * never holds balances. A fix with an approved action can be asked for here;
 * it runs only after an owner or admin approves it under Connected sources.
 *
 * Signal pass (2026-11-18): the numbers are KPI tiles ($0 reads "No revenue yet"); each app
 * row leads with its icon and one status mark; product chips are coloured by store state
 * (in review amber, approved green, missing red); findings that differ only by product are
 * one row ("3 products in review: pack_5 · pack_10 · pack_25 → Submit in App Store
 * Connect"); offerings are a packages × platform grid. RevenueCat sends no history, so the
 * tiles have no sparkline or delta.
 *
 * One level of card (2026-11-18 sweep): the hub, each app and its Checks are rows split by
 * hairlines inside the one Section, never boxes in boxes. Apps are worst first; products the
 * store is still reviewing wait (◷), they do not fail (✕).
 *
 * Data: GET  /v1/admin/orgs/:orgId/monetization
 *       POST /v1/admin/orgs/:orgId/connector-actions   (ask; nothing runs)
 */

import { useState } from 'react'
import { Btn, Callout, CopyButton, Section } from '../ui'
import { TimedLoading } from './TimedLoading'
import { IconChevronDown, IconChevronRight } from '../icons'
import { StatusGlyph } from '../signal/StatusGlyph'
import { formatRelative } from '../ui/metrics'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { PageLoadError } from '../PageLoadError'
import { ProjectFavicon } from '../ProjectFavicon'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'
import type { IconFor } from './AppIconChips'
import {
  actionRequest,
  appProducts,
  appStatus,
  fixPrompt,
  groupMonetizationFindings,
  HEADLINE_METRICS,
  kpiTile,
  offeringPlatforms,
  productState,
  productStatus,
  RULE_TITLE,
  sortAppsWorstFirst,
  type MonetizationAppView,
  type MonetizationFinding,
  type MonetizationFindingGroup,
  type MonetizationHubView,
  type MonetizationResponse,
} from './monetizationView'

const SEV_MARK: Record<MonetizationFinding['severity'], { status: RunStatus; word: string }> = {
  error: { status: 'failed', word: 'Fix' },
  warn: { status: 'failed', word: 'Fix' },
  info: { status: 'idle', word: 'Note' },
}

const RULE_MARK: Record<MonetizationAppView['rules'][number]['state'], RunStatus> = {
  ok: 'passed',
  finding: 'failed',
  unknown: 'waiting',
  error: 'failed',
}

export function MonetizationCard({ orgId, iconFor }: { orgId: string; iconFor?: IconFor }) {
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
      {error && <PageLoadError error={error} resource="payments" endpoint={path} onRetry={reload} />}
      <TimedLoading waiting={loading && !data && !error} text="Reading what each app sells…" what="Payments" onRetry={reload} testId="portfolio-payments-not-checked" />
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
        <div className="flex flex-col gap-3 divide-y divide-edge-subtle [&>*:not(:first-child)]:pt-3">
          {data.hubs.map((hub) => (
            <HubBlock key={hub.rcProjectId} hub={hub} busy={busy} onAsk={ask} iconFor={iconFor} planned={data.planned} />
          ))}
          {data.outsideHub.length > 0 && (
            <div className="border-t border-edge-subtle pt-2">
              <p className="text-xs font-semibold text-fg">Selling outside any RevenueCat project</p>
              <ul className="mt-1 divide-y divide-edge-subtle">
                {data.outsideHub.map((o) => (
                  <li key={o.projectId} className="flex items-center gap-2 py-1">
                    {iconFor && <ProjectFavicon {...iconFor(o.projectId)} size={12} />}
                    <FindingGroupRow group={groupMonetizationFindings([o.finding])[0]!} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.planned.length > 0 && (
            <p className="text-2xs text-fg-muted">
              Planned, not checked yet: {data.planned.map((id) => RULE_TITLE[id] ?? id).join(', ')} (needs the purchases SDK version from the recipe or ingest).
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

type AskFn = (hub: MonetizationHubView, finding: MonetizationFinding, projectId: string | null, key: string) => void

function HubBlock({ hub, busy, onAsk, iconFor, planned }: { hub: MonetizationHubView; busy: string | null; onAsk: AskFn; iconFor?: IconFor; planned: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid={`payments-hub-${hub.rcProjectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg">
          RevenueCat <code className="font-mono text-2xs text-fg-secondary">{hub.rcProjectId}</code>
          {hub.observedAt && <span className="ml-2 text-2xs font-normal text-fg-muted">read {formatRelative(hub.observedAt)}</span>}
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
      {(() => {
        // 2026-11-18 (owner): four boxes of "0 · None yet" inside the card was a card in a card.
        // The numbers sit on one row; when every one is zero, one line says so.
        const tiles = HEADLINE_METRICS.map((m) => ({ ...m, ...kpiTile(hub.metrics, m.id) }))
        if (tiles.every((t) => t.sublabel === 'None yet' || t.sublabel === 'No revenue yet')) {
          return (
            <p className="flex items-center gap-1.5 text-xs text-fg-secondary" data-testid="payments-kpis">
              <StatusGlyph tone="off" />
              No subscribers, trials or revenue yet.
            </p>
          )
        }
        return (
          <dl className="flex flex-wrap gap-x-6 gap-y-1" aria-label="RevenueCat numbers" data-testid="payments-kpis">
            {tiles.map((t) => (
              <div key={t.id} className="flex items-baseline gap-1.5">
                <dt className="text-2xs text-fg-muted">{t.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-fg">{t.value}</dd>
                {t.sublabel && <dd className="text-2xs text-fg-faint">{t.sublabel}</dd>}
              </div>
            ))}
          </dl>
        )
      })()}
      {hub.metrics?.state === 'unknown' && <p className="text-2xs text-fg-muted">Numbers not read: {hub.metrics.reason}</p>}
      <CatalogLine catalog={hub.catalog} />
      <ul className="divide-y divide-edge-subtle border-y border-edge-subtle" data-testid="payments-apps">
        {sortAppsWorstFirst(hub.apps).map((app) => (
          <li key={app.projectId}>
            <AppBlock hub={hub} app={app} busy={busy} onAsk={onAsk} iconFor={iconFor} planned={planned} />
          </li>
        ))}
      </ul>
      {hub.unattributed.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg" title="No product, catalog entry or recipe says which app these belong to.">
            Not tied to an app
          </p>
          <ul className="mt-1 divide-y divide-edge-subtle">
            {groupMonetizationFindings(hub.unattributed).map((g) => (
              <li key={g.key} className="py-1">
                <FindingGroupRow group={g} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function CatalogLine({ catalog }: { catalog: MonetizationHubView['catalog'] }) {
  if (catalog.state === 'read') {
    return (
      // Label above the value: at 390 "Billing / catalog" wrapped beside a path cut as "kensaurus- / spine" (round 3).
      <p className="flex min-w-0 items-start gap-1.5 text-2xs text-fg-secondary">
        <StatusMark status="passed" />
        <span className="flex min-w-0 flex-col">
          <span>Billing catalog</span>
          <code className="font-mono wrap-break-word">{catalog.source}</code>
        </span>
      </p>
    )
  }
  if (catalog.state === 'error') {
    return (
      <p className="flex items-center gap-1.5 text-2xs font-semibold text-st-failed-ink">
        <StatusMark status="failed" />
        Billing catalog {catalog.source} could not be read: {catalog.reason}
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-2xs text-fg-secondary">
      <StatusMark status="idle" />
      Set <code className="font-mono">links.billing.catalog</code> in the recipe to compare against a billing catalog.
    </p>
  )
}

function AppBlock({ hub, app, busy, onAsk, iconFor, planned }: { hub: MonetizationHubView; app: MonetizationAppView; busy: string | null; onAsk: AskFn; iconFor?: IconFor; planned: readonly string[] }) {
  const mark = appStatus(app, planned)
  const groups = groupMonetizationFindings(app.findings, appProducts(app))
  // Something to fix opens the app (amber warnings too, not only red failures).
  const [open, setOpen] = useState(app.findings.some((f) => f.severity !== 'info'))
  const [checksOpen, setChecksOpen] = useState(false)
  return (
    <div>
      {/* A row, not a box: the name wraps on a phone instead of truncating beside its pill. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-1 py-2 text-left text-sm font-medium text-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        <span className="shrink-0 text-fg-muted" aria-hidden="true">
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5" data-testid={`payments-app-${app.projectId}`}>
          {iconFor && <ProjectFavicon {...iconFor(app.projectId)} size={12} />}
          <span className="min-w-0 wrap-break-word">{app.name}</span>
        </span>
        <StatusPill status={mark.status} label={mark.label} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pb-2.5 pl-5 pr-1">
          {groups.length > 0 && (
            <ul className="divide-y divide-edge-subtle" aria-label="Why a purchase would fail">
              {groups.map((g) => (
                <li key={g.key} className="py-1">
                  <FindingGroupRow group={g} hub={hub} projectId={app.projectId} busy={busy} onAsk={onAsk} />
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="min-w-0">
              <p className="text-2xs font-semibold text-fg-secondary">Entitlements</p>
              {app.entitlements.length === 0 ? (
                <p className="text-xs text-fg-muted">None tied to this app.</p>
              ) : (
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {app.entitlements.map((e) => (
                    <li key={e.lookupKey} className="flex flex-wrap items-center gap-1 text-xs">
                      <code className="font-mono text-fg">{e.lookupKey}</code>
                      <Products products={e.products} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <OfferingsGrid app={app} />
          </div>
          <div className="border-t border-edge-subtle pt-1.5">
            <button
              type="button"
              aria-expanded={checksOpen}
              onClick={() => setChecksOpen(!checksOpen)}
              className="inline-flex items-center gap-1 rounded-sm text-2xs font-semibold text-fg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              data-testid={`payments-checks-${app.projectId}`}
            >
              <span aria-hidden="true">{checksOpen ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}</span>
              Checks ({app.rules.length})
            </button>
            {checksOpen && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {app.rules.map((r) => (
                  <li key={r.ruleId} className="flex flex-wrap items-center gap-1.5 text-xs" title={r.reason}>
                    <StatusMark status={RULE_MARK[r.state]} label={r.state === 'ok' ? 'OK' : r.state === 'finding' ? 'To fix' : r.state === 'unknown' ? 'Not checked' : 'Could not check'} />
                    <span className="font-semibold text-fg">{RULE_TITLE[r.ruleId] ?? r.ruleId}</span>
                    {(r.state === 'unknown' || r.state === 'error') && <span className="text-fg-muted">{r.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Packages × platform: each cell is the product chip for that store, "—" when none. */
function OfferingsGrid({ app }: { app: MonetizationAppView }) {
  const platforms = offeringPlatforms(app)
  return (
    <div className="min-w-0">
      <p className="text-2xs font-semibold text-fg-secondary">Offerings</p>
      {app.offerings.length === 0 ? (
        <p className="text-xs text-fg-muted">None tied to this app.</p>
      ) : (
        <>
        {/* A phone stacks each package's platforms: the table scrolled and hid Android at 390 (round 3). */}
        <ul className="mt-0.5 flex flex-col gap-1.5 sm:hidden" data-testid="offerings-stacked">
          {app.offerings.map((o) => (
            <li key={o.lookupKey} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                <code className="font-mono font-semibold text-fg">{o.lookupKey}</code>
                {o.isCurrent && <StatusPill status="running" label="current" />}
                <StatusMark status={o.hasPaywall ? 'passed' : 'idle'} label={o.hasPaywall ? 'Paywall set' : 'No paywall'} />
              </span>
              {o.packages === null ? (
                <span className="text-2xs text-fg-muted">Packages not read yet.</span>
              ) : (
                <ul className="flex flex-col divide-y divide-edge-subtle pl-2">
                  {o.packages.map((k) => (
                    <li key={k.id} className="flex flex-col gap-0.5 py-1">
                      <code className="font-mono text-2xs text-fg-secondary">{k.lookupKey}</code>
                      {platforms.map((pf) => {
                        const here = k.products.filter((p) => p.platform === pf)
                        return (
                          <span key={pf} className="flex flex-wrap items-center gap-1 text-2xs" data-platform={pf}>
                            <span className="w-14 shrink-0 text-fg-muted">{pf}</span>
                            {here.length === 0 ? (
                              <span className="text-fg-muted">none</span>
                            ) : (
                              here.map((p) => <ProductChip key={p.id} product={p} />)
                            )}
                          </span>
                        )
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {/* Long store product ids: the table scrolls in its own box, never the page. `relative` keeps
            its screen-reader-only text (absolutely placed) inside that box too. */}
        <div className="relative hidden min-w-0 overflow-x-auto sm:block" data-testid="offerings-scroll">
        <table className="mt-0.5 w-full border-collapse text-xs" data-testid="offerings-grid">
          <caption className="sr-only">Offerings of {app.name}: products by platform</caption>
          <thead>
            <tr className="border-b border-edge">
              <th scope="col" className="px-1 py-0.5 text-left text-2xs font-semibold text-fg-secondary">Package</th>
              {platforms.map((pf) => (
                <th key={pf} scope="col" className="px-1 py-0.5 text-left text-2xs font-semibold text-fg-secondary">
                  {pf}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {app.offerings.map((o) => [
              <tr key={`${o.lookupKey}:head`} className="bg-surface-overlay/40">
                <th scope="colgroup" colSpan={platforms.length + 1} className="px-1 py-0.5 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <code className="font-mono font-semibold text-fg">{o.lookupKey}</code>
                    {o.isCurrent && <StatusPill status="running" label="current" />}
                    <StatusMark status={o.hasPaywall ? 'passed' : 'idle'} label={o.hasPaywall ? 'Paywall set' : 'No paywall'} />
                  </span>
                </th>
              </tr>,
              ...(o.packages === null
                ? [
                    <tr key={`${o.lookupKey}:unread`}>
                      <td colSpan={platforms.length + 1} className="ci-nodata px-1 py-0.5 text-fg-muted">
                        Packages not read yet.
                      </td>
                    </tr>,
                  ]
                : o.packages.map((k) => (
                    <tr key={`${o.lookupKey}:${k.id}`} className="border-b border-edge-subtle" data-testid={`offering-row-${k.lookupKey}`}>
                      <th scope="row" className="px-1 py-0.5 text-left font-normal">
                        <code className="font-mono text-fg-secondary">{k.lookupKey}</code>
                      </th>
                      {platforms.map((pf) => {
                        const here = k.products.filter((p) => p.platform === pf)
                        return (
                          <td key={pf} className={`px-1 py-0.5 ${here.length === 0 ? 'ci-nodata' : ''}`} data-platform={pf}>
                            {here.length === 0 ? (
                              <span className="text-fg-muted" title={`No ${pf} product`}>—</span>
                            ) : (
                              <span className="flex flex-wrap gap-0.5">
                                {here.map((p) => (
                                  <ProductChip key={p.id} product={p} />
                                ))}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))),
            ])}
          </tbody>
        </table>
        </div>
        </>
      )}
    </div>
  )
}

type Product = NonNullable<MonetizationAppView['entitlements'][number]['products']>[number]

function ProductChip({ product, withPlatform = false }: { product: Product; withPlatform?: boolean }) {
  const st = productState(product)
  return (
    <StatusPill
      status={productStatus(product)}
      label={withPlatform && product.platform ? `${product.platform} · ${product.storeIdentifier}` : product.storeIdentifier}
      title={`${product.platform || 'Unknown platform'} · ${product.storeIdentifier}: ${st.text}`}
    />
  )
}

function Products({ products }: { products: MonetizationAppView['entitlements'][number]['products'] }) {
  if (products === null) return <StatusPill status="idle" label="products not read yet" />
  if (products.length === 0) return <StatusPill status="failed" label="no products" />
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {products.map((p) => (
        <ProductChip key={p.id} product={p} withPlatform />
      ))}
    </span>
  )
}

/** One grouped finding: mark, title, targets, → action, copy and (for one finding) ask. Open for each finding's words. */
function FindingGroupRow({
  group,
  hub,
  projectId = null,
  busy = null,
  onAsk,
}: {
  group: MonetizationFindingGroup
  hub?: MonetizationHubView
  projectId?: string | null
  busy?: string | null
  onAsk?: AskFn
}) {
  const [open, setOpen] = useState(false)
  const mark = group.waiting ? { status: 'waiting' as RunStatus, word: 'Waiting on the store' } : SEV_MARK[group.severity]
  const single = group.findings.length === 1 ? group.findings[0]! : null
  const askButton = (f: MonetizationFinding) => {
    if (!f.action || !hub?.connector || !onAsk) return null
    const key = `${projectId}:${f.ruleId}:${f.target}`
    return (
      <Btn size="sm" variant="ghost" loading={busy === key} disabled={busy !== null} onClick={() => onAsk(hub, f, projectId, key)}>
        Ask to fix
      </Btn>
    )
  }
  return (
    <div className="ci-rise min-w-0 flex-1" data-testid={`payments-finding-${group.ruleId}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusMark status={mark.status} label={mark.word} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-w-0 truncate rounded-sm text-left text-xs font-semibold text-fg hover:underline focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          title={single ? single.message : group.findings.map((f) => f.message).join('\n')}
        >
          {group.title}
          {!single && group.targets.length > 0 && ':'}
        </button>
        {!single && group.targets.length > 0 && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 font-mono text-2xs text-fg-secondary" data-testid="payments-finding-targets">
            {group.targets.map((t, i) => (
              <span key={t}>
                {i > 0 && <span aria-hidden="true">· </span>}
                {t}
              </span>
            ))}
          </span>
        )}
        <span className="min-w-0 truncate text-2xs font-semibold text-fg-secondary" title={group.action}>
          → {group.action}
        </span>
        <span className="ml-auto flex shrink-0 gap-1">
          <CopyButton value={group.findings.map(fixPrompt).join('\n\n')} label="Copy fix" />
          {single && askButton(single)}
        </span>
      </div>
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5 pl-5 text-2xs text-fg-secondary">
          {group.findings.map((f) => (
            <li key={`${f.ruleId}:${f.target}`} className="flex flex-wrap items-center gap-x-2">
              <span>{f.message}</span>
              <span className="text-fg-muted">{f.fix}</span>
              {!single && askButton(f)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
