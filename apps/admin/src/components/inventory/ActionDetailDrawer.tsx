import { Drawer } from '../Drawer'
import { Badge } from '../ui'
import { InventoryStatusPill } from './InventoryStatusPill'
import { Btn } from '../ui'

/**
 * Action drawer — replaces the previous JSON.stringify dumps with proper
 * structured fields. Anything we know how to render gets a labeled section;
 * anything else falls through to the bottom "Raw" toggle so power users can
 * still see what the API returned.
 */
interface Props {
  open: boolean
  onClose: () => void
  title: string
  status?: string
  meta?: Record<string, unknown> | null
  nodeId?: string
  transitions?: Array<{
    id: string
    from_status: string | null
    to_status: string
    trigger: string
    changed_at: string
  }>
}

interface ApiDep {
  method: string
  path: string
}

interface DbDep {
  table: string
  schema?: string
  operation?: string
}

interface TestRef {
  file: string
  name: string
  framework?: string
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function frameworkLabel(t: TestRef): string {
  return t.framework ?? 'test'
}

export function ActionDetailDrawer({
  open,
  onClose,
  title,
  status,
  meta,
  nodeId,
  transitions,
}: Props) {
  const intent = typeof meta?.intent === 'string' ? meta.intent : typeof meta?.action === 'string' ? meta.action : null
  const claimed = typeof meta?.claimed_status === 'string' ? meta.claimed_status : null
  const apis = asArray<ApiDep>(meta?.backend ?? meta?.apis)
  const tests = asArray<TestRef>(meta?.verified_by ?? meta?.tests)
  const writes = asArray<DbDep>(meta?.db_writes)
  const reads = asArray<DbDep>(meta?.db_reads)
  const lastVerified = typeof meta?.last_verified === 'string' ? meta.last_verified : null

  return (
    <Drawer open={open} onClose={onClose} title={title} width="lg" ariaLabel="Action detail">
      <div className="space-y-5 text-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Derived status</span>
            <InventoryStatusPill status={status} />
          </div>
          {claimed && claimed !== status && (
            <div className="flex items-center gap-2 text-2xs text-fg-faint">
              <span>YAML claim:</span>
              <InventoryStatusPill status={claimed} />
              <span className="text-warn">disagreement</span>
            </div>
          )}
        </div>

        {nodeId && (
          <p className="text-2xs font-mono text-fg-faint break-all">node_id: {nodeId}</p>
        )}

        {intent && (
          <section>
            <p className="text-2xs uppercase text-fg-faint mb-1">Intent</p>
            <p className="text-fg-secondary leading-relaxed">{intent}</p>
          </section>
        )}

        {apis.length > 0 && (
          <section>
            <p className="text-2xs uppercase text-fg-faint mb-1.5">Backend ({apis.length})</p>
            <ul className="space-y-1">
              {apis.map((a, i) => (
                <li
                  key={`${a.method}-${a.path}-${i}`}
                  className="flex items-center gap-2 rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-1"
                >
                  <Badge className="bg-brand/10 text-brand border border-brand/20 font-mono">
                    {a.method}
                  </Badge>
                  <code className="text-2xs font-mono text-fg-secondary truncate">{a.path}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(writes.length > 0 || reads.length > 0) && (
          <section>
            <p className="text-2xs uppercase text-fg-faint mb-1.5">Database</p>
            <ul className="space-y-1">
              {writes.map((d, i) => (
                <li
                  key={`w-${i}`}
                  className="flex items-center gap-2 rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-1"
                >
                  <Badge className="bg-danger-muted text-danger border border-danger/25 font-mono">
                    {(d.operation ?? 'write').toUpperCase()}
                  </Badge>
                  <code className="text-2xs font-mono text-fg-secondary">
                    {(d.schema ?? 'public')}.{d.table}
                  </code>
                </li>
              ))}
              {reads.map((d, i) => (
                <li
                  key={`r-${i}`}
                  className="flex items-center gap-2 rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-1"
                >
                  <Badge className="bg-info-muted text-info border border-info/25 font-mono">
                    READ
                  </Badge>
                  <code className="text-2xs font-mono text-fg-secondary">
                    {(d.schema ?? 'public')}.{d.table}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <p className="text-2xs uppercase text-fg-faint mb-1.5">
            Verified by ({tests.length})
          </p>
          {tests.length === 0 ? (
            <div className="rounded-sm border border-danger/25 bg-danger-muted p-2 text-2xs text-danger">
              No <code className="font-mono">verified_by</code> entry. Without a test reference,
              this action can never reach <strong>verified</strong> status — the reconciler will
              keep it at <strong>wired</strong> at best. Add a Playwright/Vitest spec and
              re-ingest <code className="font-mono">inventory.yaml</code>.
            </div>
          ) : (
            <ul className="space-y-1">
              {tests.map((t, i) => (
                <li
                  key={`${t.file}-${t.name}-${i}`}
                  className="rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge className="bg-ok-muted text-ok border border-ok/25 font-mono">
                      {frameworkLabel(t)}
                    </Badge>
                    <span className="text-fg-secondary truncate">{t.name}</span>
                  </div>
                  <code className="text-2xs font-mono text-fg-faint break-all">{t.file}</code>
                </li>
              ))}
            </ul>
          )}
          {lastVerified && (
            <p className="text-2xs text-fg-faint mt-1.5">
              Last verified: {new Date(lastVerified).toLocaleString()}
            </p>
          )}
        </section>

        {transitions && transitions.length > 0 && (
          <section>
            <p className="text-2xs uppercase text-fg-faint mb-2">Status history</p>
            <ul className="space-y-1 max-h-48 overflow-auto text-2xs">
              {transitions.slice(0, 50).map((t) => (
                <li key={t.id} className="border-l-2 border-edge-subtle pl-2">
                  <span className="text-fg-muted">{new Date(t.changed_at).toLocaleString()}</span>
                  <br />
                  {t.from_status ?? '∅'} → <strong>{t.to_status}</strong>
                  <span className="text-fg-faint"> — {t.trigger}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="pt-1">
          <summary className="text-2xs text-fg-faint cursor-pointer hover:text-fg-muted">
            Raw metadata
          </summary>
          <pre className="text-2xs bg-surface-overlay/50 p-2 rounded-sm overflow-auto max-h-48 mt-1 font-mono">
            {JSON.stringify(meta ?? {}, null, 2)}
          </pre>
        </details>

        <Btn variant="ghost" type="button" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Drawer>
  )
}
