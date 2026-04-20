/**
 * FILE: apps/admin/src/components/PdcaContextHint.tsx
 * PURPOSE: One-glance "where am I in the PDCA loop?" chip pinned next to a
 *          page title. Solves the audit finding that 18 of 23 pages give the
 *          user no clue which stage of Plan \u2192 Do \u2192 Check \u2192 Act they're on.
 *
 *          Two flavours:
 *            - <PdcaContextHint stage="plan" />  \u2014 explicit (any header)
 *            - <PdcaContextHint />                \u2014 auto-derives from URL
 *              via stageForPath() so a page that hasn't opted in still gets
 *              context if its route is in lib/pdca.ts.
 */

import { useLocation } from 'react-router-dom'
import { PDCA_STAGES, stageForPath, type PdcaStageId } from '../lib/pdca'
import { Tooltip } from './ui'

interface PdcaContextHintProps {
  /** Override the auto-detected stage (e.g. on a workspace page that wants
   *  to anchor to a stage explicitly). Leave undefined to derive from URL. */
  stage?: PdcaStageId
  /** Hide the label text and show only the letter badge. Useful in dense
   *  contexts like table headers. */
  compact?: boolean
}

export function PdcaContextHint({ stage: stageProp, compact }: PdcaContextHintProps) {
  const { pathname } = useLocation()
  const stageId = stageProp ?? stageForPath(pathname)
  if (!stageId) return null
  const meta = PDCA_STAGES[stageId]
  return (
    <Tooltip content={`${meta.label} stage \u2014 ${meta.hint}`}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-2xs font-medium ${meta.tintBorder} ${meta.tintBg} ${meta.text}`}
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[0.55rem] font-bold leading-none ${meta.badgeBg} ${meta.badgeFg}`}
        >
          {meta.letter}
        </span>
        {!compact && <span>{meta.label}</span>}
      </span>
    </Tooltip>
  )
}
