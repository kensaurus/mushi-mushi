/**
 * FILE: apps/admin/src/components/signal/VitalText.tsx
 * PURPOSE: Text with every Web Vital in it shown as a graded badge (owner,
 *          2026-11-18): "Homepage LCP 6408ms" reads [▲ LCP 6.4 s] in the poor
 *          colour and shape. The words around it stay as they are. Text with
 *          no vital renders unchanged. No sparkline here: these sit in dense
 *          rows. Moved into the signal kit 2026-11-18.
 */
import { Fragment } from 'react'
import { VitalBadge } from './VitalBadge'
import { splitVitalText } from '../../lib/vitalText'

export function VitalText({ text }: { text: string }) {
  const parts = splitVitalText(text)
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <VitalBadge key={i} name={p.name} value={p.value} className="mx-0.5" />,
      )}
    </>
  )
}
