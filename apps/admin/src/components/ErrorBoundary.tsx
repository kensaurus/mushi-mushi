/**
 * FILE: apps/admin/src/components/ErrorBoundary.tsx
 * PURPOSE: Catches React render errors to prevent full-app crashes. Shows
 *          an editorial recovery UI instead of a blank screen, and forwards
 *          the exception to Sentry with the component stack for triage.
 *
 * EDITORIAL FALLBACK
 * ------------------
 * When no `fallback` prop is provided, the boundary renders
 * `<EditorialErrorState>` so the visitor sees the same brand voice they
 * would on a 404. The boundary intentionally does NOT depend on the
 * Layout chrome being mounted: when the app crashes during boot (e.g. a
 * lazy chunk fails to load), the Layout sidebar may itself have thrown,
 * so the recovery UI must be self-contained.
 */

import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Sentry } from '../lib/sentry'
import { EditorialErrorState } from './EditorialErrorState'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /**
   * Tag forwarded to Sentry so we can distinguish boundaries (the outer
   * "app shell" boundary catches different signals than per-page ones).
   * Defaults to `react-error-boundary` for backwards compat.
   */
  source?: string
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
      source: this.props.source ?? 'react-error-boundary',
    })
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
      tags: { source: this.props.source ?? 'react-error-boundary' },
    })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <EditorialErrorState
          // The boundary may catch a crash BEFORE Layout has mounted (lazy
          // chunk fail on first paint, env-checker explosion, AuthProvider
          // throw). In that scenario the editorial fallback IS the page
          // landmark — so we render `<main>`. Inner protected boundaries
          // wrap their fallback inside Layout, which already renders a
          // `<main id="main-content">`; in that case the default
          // `<section>` from EditorialErrorState avoids nested mains.
          // The outer "app-shell" boundary is always the page root, so
          // claim `<main>` here.
          as={this.props.source === 'app-shell' ? 'main' : 'section'}
          eyebrow="Error · 虫々"
          headline={
            <>
              Something <em>broke</em> on this page.
            </>
          }
          // Copy MUST describe only the actions actually rendered below.
          // The previous version said "Reload to try again, or head back
          // home" but the UI only ships a "Back to home" + "Open docs"
          // pair — no reload affordance. We did NOT add a reload button
          // because the boundary already remounts the failing subtree on
          // navigation; pressing the browser refresh button is the same
          // action a user takes for any unexpected error and doesn't
          // need its own affordance here. Aligning the copy with the
          // available CTAs is the smallest, lowest-risk fix.
          lead="The console caught a render error and stopped before it could cascade. Head back home or check the docs — your last save is safe and we've already received the crash report."
          detail={
            <code className="break-words">
              {this.state.error.message || 'Unknown error'}
            </code>
          }
          primary={{ href: '/', label: 'Back to home' }}
          secondary={{
            href: 'https://kensaur.us/mushi-mushi/docs/',
            label: 'Open docs',
            external: true,
          }}
        />
      )
    }

    return this.props.children
  }
}
