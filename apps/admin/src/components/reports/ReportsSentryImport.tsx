/**
 * FILE: apps/admin/src/components/reports/ReportsSentryImport.tsx
 * PURPOSE: "Import from Sentry" on the Bugs page, so pulling existing Sentry
 *          issues into the queue does not need a detour to Integrations. It
 *          reuses the Sentry card's SentryImportPanel; when Sentry is not
 *          connected yet it says so and links to the card instead.
 *          `/reports?import=sentry` opens it.
 */

import { usePageData } from '../../lib/usePageData'
import { platformRequiredOk, sentryProjectsFromConfig } from '../../lib/platformIntegrationForm'
import { PLATFORM_DEFS, type PlatformResponse } from '../integrations/types'
import { SentryImportPanel } from '../integrations/SentryImportPanel'
import { Btn, Card } from '../ui'

const SENTRY_DEF = PLATFORM_DEFS.find((d) => d.kind === 'sentry')

interface Props {
  onClose: () => void
  /** Called after an import brought at least one new report in. */
  onImported: () => void
}

export function ReportsSentryImport({ onClose, onImported }: Props) {
  const { data, loading, error, reload } = usePageData<PlatformResponse>('/v1/admin/integrations/platform')
  const config = (data?.platform?.sentry ?? {}) as Record<string, unknown>
  const connected = SENTRY_DEF != null && platformRequiredOk(SENTRY_DEF, config, data?.sourceByField)

  return (
    <Card className="p-0" data-testid="mushi-reports-sentry-import">
      <div className="flex items-start justify-between gap-3 px-3 pt-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-fg">Import open Sentry issues</h2>
          <p className="text-2xs text-fg-muted leading-snug">
            Each issue becomes a bug here with its Sentry link. Open one for the plain-English diagnosis, then
            Fix it. When the fix merges, Mushi resolves the issue in Sentry.
          </p>
        </div>
        <Btn type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close Sentry import">
          Close
        </Btn>
      </div>
      {loading && !data ? (
        <p className="px-3 py-3 text-2xs text-fg-faint">Checking your Sentry connection…</p>
      ) : error && !data ? (
        // A failed read is not "not connected": never send the user to reconnect on a guess.
        <div className="border-t border-edge-subtle px-3 py-2 mt-2 flex flex-wrap items-center gap-2">
          <p className="text-2xs text-fg-secondary flex-1 min-w-48">Couldn’t check your Sentry connection: {error}</p>
          <Btn type="button" variant="ghost" size="sm" onClick={reload}>
            Try again
          </Btn>
        </div>
      ) : connected ? (
        <SentryImportPanel sentryProjects={sentryProjectsFromConfig(config)} onImported={onImported} showHeading={false} />
      ) : (
        <div className="border-t border-edge-subtle px-3 py-2 mt-2 flex flex-wrap items-center gap-2">
          <p className="text-2xs text-fg-secondary flex-1 min-w-48">
            Sentry is not connected for this app yet. Add your Sentry org slug and an auth token, then come back.
          </p>
          <Btn to="/integrations/config" size="sm">
            Connect Sentry
          </Btn>
        </div>
      )}
    </Card>
  )
}
