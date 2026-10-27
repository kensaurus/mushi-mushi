/**
 * FILE: apps/admin/src/components/home/HomeSectionBody.tsx
 * PURPOSE: One way for every Home section to say "could not read" (a read
 *          failed) and "not connected yet" (with the button that connects
 *          it), so no section shows an empty box or a 0 it never counted.
 */

import type { ReactNode } from 'react'
import { Btn, EmptySectionMessage } from '../ui'
import type { HomeSection } from '../../lib/projectHome'

interface Props<T> {
  section: HomeSection<T>
  /** What the section is about, for the error line ("the release"). */
  what: string
  /** Text shown above the connect button when not connected. */
  notConnectedText: string
  children: (data: T) => ReactNode
}

export function HomeSectionBody<T>({ section, what, notConnectedText, children }: Props<T>) {
  if (section.status === 'error') {
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger-muted/40 px-3 py-2 text-xs text-danger-foreground">
        Could not read {what} just now. Refresh to try again.
        {section.error ? <span className="mt-0.5 block font-mono text-2xs opacity-80 break-all">{section.error}</span> : null}
      </p>
    )
  }
  if (section.status === 'not_connected') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <EmptySectionMessage text={notConnectedText} />
        </div>
        {section.connect && (
          <Btn size="sm" variant="ghost" to={section.connect.to}>
            {section.connect.label}
          </Btn>
        )}
      </div>
    )
  }
  if (section.data == null) return <EmptySectionMessage text={`Nothing to show for ${what} yet.`} />
  return <>{children(section.data)}</>
}
