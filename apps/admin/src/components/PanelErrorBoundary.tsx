/**
 * FILE: apps/admin/src/components/PanelErrorBoundary.tsx
 * PURPOSE: Lightweight per-panel ErrorBoundary so one card crash does not
 *          take down the whole route (unlike the coarse app-shell boundary).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { ErrorAlert } from './ui'

interface Props {
  children: ReactNode
  /** Label for the panel, used in the fallback copy. */
  label?: string
  /** Optional custom fallback. */
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      tags: { source: 'panel-error-boundary', panel: this.props.label ?? 'panel' },
      extra: { componentStack: info.componentStack },
    })
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <ErrorAlert
          title={this.props.label ? `${this.props.label} crashed` : 'This panel crashed'}
          message="The rest of the page should still work. Retry to remount this panel, or refresh if it keeps failing."
          code="PANEL_RENDER_ERROR"
          onRetry={this.handleRetry}
        />
      )
    }
    return this.props.children
  }
}
