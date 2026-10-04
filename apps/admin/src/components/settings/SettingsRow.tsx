/**
 * FILE: apps/admin/src/components/settings/SettingsRow.tsx
 * PURPOSE: The building blocks every Settings tab is made of, so each tab is
 *          one card holding a clean list of rows (docs/DESIGN-SYSTEM.md,
 *          "Console pages"):
 *
 *   SettingsList     one card per topic, rows divided by a hairline
 *   SettingsRow      icon · name · one-line purpose · status · the one action,
 *                    with an optional body (form fields) underneath
 *   RowStatus        the shared ConnectionStatus chip plus the reason in
 *                    readable text
 *   DeveloperDetails a collapsed disclosure at the bottom of a page for
 *                    endpoints and raw values; remembers if it was opened
 *
 * No card inside a card: rows are separated by a divider, never boxed.
 */

import type { ReactNode } from 'react'
import { DisclosurePanel, Section } from '../ui'
import { ConnectionStatus, type ConnectionState } from '../ui/ConnectionStatus'
import { usePersistentState } from '../../lib/usePersistentState'

export function SettingsList({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string
  /** One sentence under the title: what this group is for. */
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <div id={id} className={id ? 'scroll-mt-6' : undefined}>
      <Section title={title} action={action}>
        {description ? <p className="-mt-1 mb-1 text-sm text-fg-muted">{description}</p> : null}
        <div className="divide-y divide-edge-subtle">{children}</div>
      </Section>
    </div>
  )
}

export interface RowStatusValue {
  state: ConnectionState
  label?: string
  detail?: string
  expiresAt?: string | null
}

export function RowStatus({ status }: { status: RowStatusValue }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ConnectionStatus state={status.state} label={status.label} expiresAt={status.expiresAt} />
      {status.detail ? <span className="text-sm text-fg-secondary">{status.detail}</span> : null}
    </div>
  )
}

export function SettingsRow({
  id,
  icon,
  title,
  purpose,
  status,
  action,
  children,
}: {
  id?: string
  /** A BrandIcon for a service, or a console icon for a Mushi setting. */
  icon?: ReactNode
  title: ReactNode
  /** One plain-English line: what this does for you. */
  purpose?: ReactNode
  status?: RowStatusValue | ReactNode
  /** The one obvious action. */
  action?: ReactNode
  /** Fields or details that belong to this row. */
  children?: ReactNode
}) {
  const statusNode =
    status && typeof status === 'object' && 'state' in (status as RowStatusValue) ? (
      <RowStatus status={status as RowStatusValue} />
    ) : (
      (status as ReactNode)
    )
  return (
    <div id={id} className="scroll-mt-6 py-3">
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        {icon ? (
          <span
            // The row's title already names the service.
            aria-hidden="true"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge-subtle bg-surface-raised text-fg-muted"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-sm font-medium text-fg">{title}</h3>
          {purpose ? <p className="mt-0.5 text-sm text-fg-muted">{purpose}</p> : null}
          {statusNode ? <div className="mt-1.5">{statusNode}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children ? <div className={`mt-3 space-y-3 ${icon ? 'sm:pl-11' : ''}`}>{children}</div> : null}
    </div>
  )
}

/**
 * Endpoints, ids and raw values a developer may want, out of everyone
 * else's way. Collapsed until opened; remembers the choice per project.
 */
export function DeveloperDetails({
  storageKey,
  projectId,
  children,
}: {
  storageKey: string
  projectId?: string | null
  children: ReactNode
}) {
  const [open, setOpen] = usePersistentState(`${storageKey}:dev-details-open`, false, {
    projectId,
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  return (
    <DisclosurePanel
      title={<span>Developer details</span>}
      trailing={<span className="text-xs font-normal text-fg-muted">Endpoints and raw values</span>}
      open={open}
      onOpenChange={setOpen}
    >
      {children}
    </DisclosurePanel>
  )
}
