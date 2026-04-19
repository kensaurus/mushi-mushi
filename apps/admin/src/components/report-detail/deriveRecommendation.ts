import { severityLabel } from '../../lib/tokens'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

export interface Recommendation {
  title: string
  description: string
  cta?: { label: string; onClick?: () => void; href?: string; disabled?: boolean }
  tone: 'urgent' | 'info' | 'success' | 'neutral'
}

export function deriveRecommendation(
  report: ReportDetail,
  dispatchState: DispatchState,
  commentCount: number,
  onDispatch: () => void | Promise<void>,
): Recommendation {
  if (dispatchState.status === 'completed' && dispatchState.prUrl) {
    return {
      title: 'Auto-fix PR is ready for review',
      description: 'The agent finished. Review the pull request and merge or request changes.',
      cta: { label: 'View PR', href: dispatchState.prUrl },
      tone: 'success',
    }
  }

  if (dispatchState.status === 'queueing' || dispatchState.status === 'queued' || dispatchState.status === 'running') {
    return {
      title: 'Agent is working on a fix',
      description: 'Stay on this page or follow progress in the Fixes pipeline.',
      cta: { label: 'Open Fixes', href: '/fixes' },
      tone: 'info',
    }
  }

  if (report.status === 'fixed') {
    return {
      title: 'Verify the fix and close out',
      description: 'Confirm the PR is merged and the report no longer reproduces.',
      tone: 'success',
    }
  }

  if (report.status === 'dismissed') {
    return {
      title: 'This report is dismissed',
      description: 'No further action is needed. Reopen by changing the status above if it resurfaces.',
      tone: 'neutral',
    }
  }

  if (report.status === 'fixing') {
    return {
      title: 'A fix is in progress',
      description: 'Track the active dispatch in the Fixes pipeline.',
      cta: { label: 'Open Fixes', href: '/fixes' },
      tone: 'info',
    }
  }

  if (!report.stage1_classification && !report.processing_error) {
    return {
      title: 'Classification pending',
      description: 'The LLM pipeline is still processing this report. Refresh in a few seconds.',
      tone: 'neutral',
    }
  }

  if (report.processing_error) {
    return {
      title: 'Classification failed — triage manually',
      description: 'Pick a status and severity by hand, or dispatch a fix once you understand the issue.',
      tone: 'urgent',
    }
  }

  if (report.status === 'new' && (report.severity === 'critical' || report.severity === 'high')) {
    return {
      title: `Confirm priority for this ${severityLabel(report.severity).toLowerCase()} bug`,
      description: 'Set the status to Classified, then dispatch a fix or hand off to engineering.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'urgent',
    }
  }

  if (report.status === 'classified' && commentCount === 0) {
    return {
      title: 'Triage this report',
      description: 'Add a triage note for context, or dispatch an autofix attempt.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  if (report.status === 'new') {
    return {
      title: 'Start triage',
      description: 'Set the severity and update status, or dispatch a fix if confidence is high.',
      cta: { label: 'Dispatch fix', onClick: () => onDispatch() },
      tone: 'info',
    }
  }

  return {
    title: 'No suggested action',
    description: 'Use the controls above to update status, severity, or dispatch a fix.',
    tone: 'neutral',
  }
}
