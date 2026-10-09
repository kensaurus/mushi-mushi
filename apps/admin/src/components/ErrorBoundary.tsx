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
 *
 * RESET ON NAVIGATION
 * -------------------
 * A React error boundary keeps its caught error until it is remounted or
 * explicitly reset — it does NOT clear itself when its children change.
 * This boundary wraps <Routes> for the whole protected console, so before
 * `resetKeys` existed one page crash (IteratePage, 2026-09-23) left EVERY
 * subsequent route rendering the fallback: /dashboard, /reports, anything,
 * still said "Something broke" until a hard reload, and the only affordance
 * was a "Back to home" link that navigated in-app and so changed nothing.
 * `RouteErrorBoundary` keys the reset on `location.pathname`: leaving the
 * crashed page clears the error and the next page renders normally. The
 * crashed page still shows the fallback if you return and it throws again.
 */

import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { useLocation } from 'react-router-dom'
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
  /**
   * When any value here changes while the boundary is showing an error,
   * the error is cleared and `children` render again. Compared with
   * `Object.is` element-wise. `RouteErrorBoundary` passes
   * `[location.pathname]`; pass your own keys for narrower boundaries.
   */
  resetKeys?: ReadonlyArray<unknown>
}

interface State {
  error: Error | null
}

function resetKeysChanged(
  prev: ReadonlyArray<unknown> | undefined,
  next: ReadonlyArray<unknown> | undefined,
): boolean {
  if (prev === next) return false
  if (!prev || !next || prev.length !== next.length) return true
  return prev.some((value, i) => !Object.is(value, next[i]))
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

  componentDidUpdate(prevProps: Props) {
    // Only ever transitions error → null, and only when a key actually
    // changed, so this cannot loop.
    if (this.state.error && resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null })
    }
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
          eyebrow="Error · render"
          headline={
            <>
              Something <em>broke</em> on this page.
            </>
          }
          // Copy MUST describe only the actions actually rendered below:
          // a "Back to home" + "Open docs" pair. With `resetKeys` wired
          // (RouteErrorBoundary), "Back to home" genuinely recovers because
          // the pathname change clears the error — before that it was an
          // in-app navigation into the same stuck boundary.
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

/**
 * ErrorBoundary that clears its error whenever the route pathname changes.
 * Use it around <Routes>; a crash on one page must not take the rest of the
 * console down with it. Query-string changes (tabs, filters) do not reset,
 * so a page that crashes on a particular tab keeps showing the fallback
 * until you leave the page.
 */
export function RouteErrorBoundary(props: Omit<Props, 'resetKeys'>) {
  const { pathname } = useLocation()
  return <ErrorBoundary {...props} resetKeys={[pathname]} />
}
