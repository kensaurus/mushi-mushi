import { RelativeTime } from '../ui'
import { EndpointCodeRow } from '../readout'
import { IconExternalLink } from '../icons'
import { usePageData } from '../../lib/usePageData'
import {
  EVIDENCE_BADGE,
  PROVIDER_LABEL,
  type QaEvidence,
  type QaStoryRun,
} from './qaStoryTypes'

export interface RunDetailProps {
  run: QaStoryRun
  projectId: string
  storyId: string
  isDirectFetch?: boolean
}

export function RunDetail({ run, projectId, storyId, isDirectFetch }: RunDetailProps) {
  const { data: evData, loading: evLoading } = usePageData<{ evidence: QaEvidence[] }>(
    `/v1/admin/projects/${projectId}/qa-stories/${storyId}/runs/${run.id}/evidence`,
    { deps: [run.id] },
  )
  const evidence = evData?.evidence ?? []

  const durationSecs =
    run.latency_ms != null
      ? (run.latency_ms / 1000).toFixed(1)
      : run.finished_at
        ? (
            (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) /
            1000
          ).toFixed(1)
        : null

  return (
    <div className="border-t border-edge-subtle mt-2 pt-3 space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-secondary">
        <span>
          <span className="text-fg-faint">Triggered by</span>{' '}
          <span className="font-medium">{run.triggered_by ?? 'cron'}</span>
        </span>
        {run.provider && (
          <span>
            <span className="text-fg-faint">Provider</span>{' '}
            <span className="font-medium">{PROVIDER_LABEL[run.provider] ?? run.provider}</span>
          </span>
        )}
        {durationSecs && (
          <span>
            <span className="text-fg-faint">Duration</span>{' '}
            <span className="font-medium tabular-nums">{durationSecs}s</span>
          </span>
        )}
        {run.finished_at && (
          <span>
            <span className="text-fg-faint">Finished</span>{' '}
            <RelativeTime value={run.finished_at} />
          </span>
        )}
      </div>

      {run.summary && <p className="text-2xs text-fg-secondary leading-relaxed">{run.summary}</p>}

      {run.error_message && (
        <div className="rounded-sm border border-danger/25 bg-danger/5 px-3 py-2">
          <div className="text-3xs font-semibold text-danger uppercase tracking-wider mb-1">Error</div>
          <pre className="text-2xs font-mono text-danger whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
            {run.error_message}
          </pre>
        </div>
      )}

      {run.assertion_failures?.length > 0 && (
        <div>
          <div className="text-3xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Assertion failures ({run.assertion_failures.length})
          </div>
          <div className="rounded-sm border border-edge-subtle overflow-hidden">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-surface-raised border-b border-edge-subtle">
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Step</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Expected</th>
                  <th className="text-left px-2.5 py-1.5 font-medium text-fg-muted w-1/3">Got</th>
                </tr>
              </thead>
              <tbody>
                {run.assertion_failures.map((f, i) => (
                  <tr key={i} className="border-t border-edge-subtle/50 align-top">
                    <td className="px-2.5 py-1.5 font-mono text-fg truncate max-w-0 w-1/3">
                      <span title={f.step}>{f.step}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-fg-secondary italic max-w-0 w-1/3">
                      <span title={f.expected ?? '(any)'}>
                        {f.expected ?? <em className="text-fg-faint">any</em>}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-danger italic max-w-0 w-1/3">
                      <span title={f.actual ?? '(missing)'}>{f.actual ?? <em>missing</em>}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {evLoading && <div className="text-2xs text-fg-faint italic">Loading evidence…</div>}
      {!evLoading && evidence.length > 0 && (
        <div>
          <div className="text-3xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">
            Evidence ({evidence.length})
          </div>
          <div className="space-y-2">
            {evidence.map((ev) => (
              <div key={ev.id} className="rounded-sm border border-edge-subtle overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-raised border-b border-edge-subtle">
                  <span
                    className={`text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${EVIDENCE_BADGE[ev.kind] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}
                  >
                    {ev.kind}
                  </span>
                  {ev.step_label && (
                    <span className="text-3xs font-mono text-fg-secondary truncate">{ev.step_label}</span>
                  )}
                  <span className="text-3xs text-fg-faint ml-auto tabular-nums">
                    <RelativeTime value={ev.captured_at} />
                  </span>
                </div>
                {(ev.kind === 'screenshot' || ev.kind === 'video') && ev.signed_url ? (
                  ev.kind === 'screenshot' ? (
                    <a href={ev.signed_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={ev.signed_url}
                        alt={ev.step_label ?? 'Screenshot'}
                        className="w-full max-h-48 object-contain bg-surface-overlay"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <video src={ev.signed_url} controls className="w-full max-h-48" />
                  )
                ) : ev.signed_url ? (
                  <div className="px-2.5 py-2">
                    <a
                      href={ev.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-2xs text-brand hover:underline"
                    >
                      <IconExternalLink className="h-3 w-3" />
                      Download {ev.kind}
                    </a>
                  </div>
                ) : (
                  <div className="px-2.5 py-2 text-2xs text-fg-faint italic">{ev.storage_path}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!evLoading && evidence.length === 0 &&
        (isDirectFetch ? (
          <div className="flex items-start gap-1.5 rounded-sm border border-edge-subtle/50 bg-surface-raised/60 px-2.5 py-2">
            <span className="text-3xs font-medium text-fg-muted mt-px">Content-only mode</span>
            <span className="text-2xs text-fg-faint leading-relaxed">
              Assertions verified against raw HTML — no screenshots or session replay captured.
            </span>
          </div>
        ) : (
          <p className="text-2xs text-fg-faint italic">No evidence captured for this run.</p>
        ))}

      {run.provider_session_url && (
        <div className="space-y-1.5">
          <a
            href={run.provider_session_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-2xs text-brand hover:underline font-medium"
          >
            Open session replay in {PROVIDER_LABEL[run.provider ?? ''] ?? run.provider}
          </a>
          <EndpointCodeRow label="Provider session" url={run.provider_session_url} />
        </div>
      )}
    </div>
  )
}
