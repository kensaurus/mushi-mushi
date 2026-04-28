import Link from 'next/link'
import { AuthShell, authGhostBtnClass, authPrimaryBtnClass } from '@/app/_components/AuthShell'
import { docsUrl } from '@/lib/links'

export default function CheckEmailPage() {
  return (
    <AuthShell
      chapter="Chapter 04 / one more click"
      title="Check your email."
      subtitle={
        <>
          We sent a confirmation link to your inbox. Click it to finish creating
          your project — the link expires in <span className="text-[var(--mushi-ink)]">24 hours</span>.
        </>
      }
    >
      <div className="space-y-5 text-sm leading-6 text-[var(--mushi-ink-muted)]">
        <p>
          Didn&rsquo;t see anything? Check your spam folder, or{' '}
          <Link
            href="/signup"
            className="font-mono uppercase tracking-[0.18em] text-[var(--mushi-vermillion)] underline decoration-[var(--mushi-vermillion)] underline-offset-4 hover:text-[var(--mushi-ink)]"
          >
            try again
          </Link>{' '}
          with a different address.
        </p>

        <ol className="list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[var(--mushi-vermillion)]">
          <li>Open the email titled <span className="text-[var(--mushi-ink)]">Confirm your Mushi Mushi project</span>.</li>
          <li>Click <span className="text-[var(--mushi-ink)]">Confirm</span> — it lands you on your dashboard.</li>
          <li>Drop your first SDK key in <code className="font-mono text-[12px] text-[var(--mushi-ink)]">app.tsx</code> and watch the loop run.</li>
        </ol>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link href={docsUrl('/quickstart')} className={authPrimaryBtnClass}>
            Skim the quickstart →
          </Link>
          <Link href="/" className={authGhostBtnClass}>
            ← Marketing tour
          </Link>
        </div>
      </div>
    </AuthShell>
  )
}
