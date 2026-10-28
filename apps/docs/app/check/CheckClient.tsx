'use client'

/**
 * Client half of /check: the form, the wait, and the report. A report id in
 * the URL (`?id=` or `/check/<uuid>`) skips the form and loads that report.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CHECK_PAGE_URL,
  CHECK_SIGNUP_HREF,
  checkIdFromLocation,
  countLine,
  groupBySeverity,
  hostOf,
  loadCheck,
  reportShareUrl,
  srcFromSearch,
  startCheck,
  type CheckReport,
  type Severity,
} from '@/lib/production-check'

type View =
  | { kind: 'form'; error?: string }
  | { kind: 'loading' }
  | { kind: 'running'; id: string; host: string }
  | { kind: 'report'; report: CheckReport }
  | { kind: 'missing'; message: string }

const POLL_MS = 2_500
const GIVE_UP_MS = 120_000

const SEVERITY_TONE: Record<Severity, string> = {
  high: 'border-mushi-danger text-mushi-danger',
  medium: 'border-mushi-warn text-mushi-warn',
  low: 'border-mushi-rule text-mushi-ink-muted',
}

export function CheckClient() {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const follow = useCallback((id: string, host: string) => {
    const started = Date.now()
    setView({ kind: 'running', id, host })
    const tick = async () => {
      const r = await loadCheck(id)
      if (r.ok && r.data.status !== 'running') {
        setView({ kind: 'report', report: r.data })
        return
      }
      if (!r.ok && r.status === 404) {
        setView({ kind: 'missing', message: r.message })
        return
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setView({ kind: 'missing', message: 'The check is taking too long. Reload this page in a minute.' })
        return
      }
      pollTimer.current = setTimeout(tick, POLL_MS)
    }
    void tick()
  }, [])

  useEffect(() => {
    const id = checkIdFromLocation(window.location.pathname, window.location.search)
    if (id) follow(id, '')
    else setView({ kind: 'form' })
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [follow])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const url = String(form.get('url') ?? '').trim()
    const email = String(form.get('email') ?? '').trim()
    if (!url) return setView({ kind: 'form', error: 'Enter your site’s address.' })
    setView({ kind: 'loading' })
    const r = await startCheck({ url, email: email || undefined, src: srcFromSearch(window.location.search) })
    if (!r.ok) return setView({ kind: 'form', error: r.message })
    const next = new URL(window.location.href)
    next.searchParams.set('id', r.data.id)
    window.history.replaceState(null, '', next)
    follow(r.data.id, hostOf(url.includes('://') ? url : `https://${url}`))
  }

  return (
    <div className="min-h-screen bg-mushi-paper">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {view.kind === 'form' && <CheckForm error={view.error} onSubmit={onSubmit} />}
        {view.kind === 'loading' && <p className="text-sm text-mushi-ink-muted">One moment…</p>}
        {view.kind === 'running' && <Running host={view.host} />}
        {view.kind === 'missing' && <Missing message={view.message} />}
        {view.kind === 'report' && <Report report={view.report} />}
      </div>
    </div>
  )
}

function CheckForm({ error, onSubmit }: { error?: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-mushi-vermillion">Free Production Check</p>
        <h1 className="text-3xl font-bold tracking-tight text-mushi-ink sm:text-4xl">Is your live app broken for new visitors?</h1>
        <p className="text-base text-mushi-ink-muted">
          Paste your address. In about 30 seconds Mushi reads your home page and three pages it links to, the way a first
          visitor sees them, and tells you in plain English what to fix: error pages, dead links, missing security
          headers, published source maps.
        </p>
      </header>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <label htmlFor="check-url" className="block text-sm font-medium text-mushi-ink">
            Your live app
          </label>
          <input
            id="check-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="https://your-app.com"
            required
            className="w-full rounded-md border border-mushi-rule bg-mushi-paper-wash px-3 py-2 text-base text-mushi-ink"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="check-email" className="block text-sm font-medium text-mushi-ink">
            Email the report to me <span className="font-normal text-mushi-ink-muted">(optional)</span>
          </label>
          <input
            id="check-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-md border border-mushi-rule bg-mushi-paper-wash px-3 py-2 text-base text-mushi-ink"
          />
          <p className="text-xs text-mushi-ink-muted">One email with the report link. Then we delete the address. No list.</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-mushi-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-mushi-cta="production_check_run"
          data-mushi-location="check_form"
          className="rounded-md bg-mushi-vermillion px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Check my app
        </button>
      </form>
      <p className="text-xs text-mushi-ink-muted">
        Public pages only: it never signs in, sends a form, or touches anything behind a login. One check per site a day.
        The report link works for 90 days.
      </p>
    </div>
  )
}

function Running({ host }: { host: string }) {
  return (
    <div className="space-y-3" aria-live="polite">
      <h1 className="text-2xl font-bold tracking-tight text-mushi-ink">Checking {host || 'your app'}…</h1>
      <p className="text-sm text-mushi-ink-muted">
        Reading your pages, following your links and looking at the headers your server sends. This takes up to 30 seconds.
      </p>
    </div>
  )
}

function Missing({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-mushi-ink">No report here</h1>
      <p className="text-sm text-mushi-ink-muted">{message}</p>
      <a href={CHECK_PAGE_URL} className="inline-block text-sm font-medium text-mushi-vermillion hover:underline">
        Run a new check →
      </a>
    </div>
  )
}

function Report({ report }: { report: CheckReport }) {
  const [copied, setCopied] = useState(false)
  const host = hostOf(report.url)
  const checkedOn = new Date(report.finished_at ?? report.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const groups = groupBySeverity(report.findings ?? [])
  const pages = report.summary?.pages ?? []

  async function share() {
    try {
      await navigator.clipboard.writeText(reportShareUrl(report.id))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link', reportShareUrl(report.id))
    }
  }

  if (report.status === 'failed') {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-mushi-ink">The check of {host} did not finish</h1>
        <p className="text-sm text-mushi-ink-muted">{report.error ?? 'Try again in a few minutes.'}</p>
        <a href={CHECK_PAGE_URL} className="inline-block text-sm font-medium text-mushi-vermillion hover:underline">
          Run a new check →
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-mushi-vermillion">Production Check</p>
        <h1 className="text-3xl font-bold tracking-tight text-mushi-ink">{host}</h1>
        <p className="text-base text-mushi-ink">{countLine(report.findings ?? [])}.</p>
        <p className="text-xs text-mushi-ink-muted">
          Checked {checkedOn}: {pages.length ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : 'the home page'}
          {report.summary?.linksChecked ? `, ${report.summary.linksChecked} links` : ''}. Public pages only.
          {report.summary?.incomplete?.length ? ` Not finished in time: ${report.summary.incomplete.join(', ')}.` : ''}
        </p>
        <button type="button" onClick={share} className="text-sm font-medium text-mushi-vermillion underline underline-offset-2">
          {copied ? 'Link copied' : 'Share this report'}
        </button>
      </header>

      {groups.map((g) => (
        <section key={g.severity} className="space-y-3">
          <h2 className={`border-l-4 pl-3 text-lg font-semibold ${SEVERITY_TONE[g.severity]}`}>
            {g.label} ({g.items.length})
          </h2>
          <ul className="space-y-4">
            {g.items.map((f) => (
              <li key={f.rule} className="rounded-md border border-mushi-rule bg-mushi-paper-wash p-4">
                <h3 className="font-semibold text-mushi-ink">{f.title}</h3>
                {f.where?.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {f.where.map((w) => (
                      <li key={w}>
                        <code className="text-xs">{w}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-sm text-mushi-ink">
                  <span className="font-medium">Why it matters: </span>
                  {f.why}
                </p>
                <p className="mt-1 text-sm text-mushi-ink">
                  <span className="font-medium">How to fix: </span>
                  {f.fix}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-3 rounded-md border border-mushi-rule p-5">
        <h2 className="text-lg font-semibold text-mushi-ink">This checked what a visitor sees today. Your users find the rest.</h2>
        <p className="text-sm text-mushi-ink-muted">
          Mushi sits in your app, takes the bug reports your users send, explains each one in plain English and hands
          Cursor, Claude Code or Lovable the fix.
        </p>
        <a
          href={CHECK_SIGNUP_HREF}
          data-mushi-cta="check_signup"
          data-mushi-location="check_report"
          className="inline-block rounded-md bg-mushi-vermillion px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Fix these automatically: install Mushi free (1 app)
        </a>
      </section>
    </div>
  )
}
