/**
 * Public sample diagnosis shown when a signed-out visitor opens the console
 * (the landing "Console" link hits `/`). The operator inbox stays behind
 * sign-in; this page is the same sample the docs site already publishes,
 * so a first visit can read "Why it broke" with no account (ADR 0052).
 */
import { Link } from 'react-router-dom'
import { docsUrl } from '../lib/docsUrl'

export function SampleReportEntry() {
  return (
    <main className="min-h-full overflow-y-auto bg-surface-root px-4 py-10">
      <article className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <p className="text-2xs font-medium uppercase tracking-wide text-fg-faint">Sample</p>
        <h1 className="text-xl font-bold text-fg">Pay now does nothing on phones</h1>
        <p className="text-sm text-fg-muted leading-relaxed">
          A diagnosis you can read before creating an account. We wrote this sample; it is not a report from your app.
        </p>
        <section className="flex flex-col gap-2 border-t border-edge pt-4">
          <h2 className="text-sm font-semibold text-fg">Why it broke</h2>
          <p className="text-sm text-fg-muted leading-relaxed">
            On a phone, tapping Pay now stops before checkout. The postcode field is hidden on a narrow screen, so the handler returns without sending the payment or showing an error. On a laptop the field is visible, and checkout works.
          </p>
        </section>
        <p className="flex flex-col gap-2 text-sm">
          <a href={docsUrl('/demo/diagnosis')} className="text-brand underline underline-offset-2">
            Read the full sample
          </a>
          <Link to="/signup" className="text-brand underline underline-offset-2">
            Create a free account
          </Link>
          <Link to="/login" className="text-fg-muted underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </article>
    </main>
  )
}
