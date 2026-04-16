/**
 * FILE: apps/admin/src/components/ErrorBoundary.tsx
 * PURPOSE: Catches React render errors to prevent full-app crashes.
 *          Shows a recovery UI instead of a blank screen.
 */

import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Card, Btn } from './ui'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[mushi:admin] ErrorBoundary caught render error', {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <Card className="m-6 p-6 text-center">
          <p className="text-sm font-medium text-danger mb-1">Something went wrong</p>
          <p className="text-xs text-fg-muted mb-3 font-mono break-all">
            {this.state.error.message}
          </p>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </Btn>
        </Card>
      )
    }

    return this.props.children
  }
}
