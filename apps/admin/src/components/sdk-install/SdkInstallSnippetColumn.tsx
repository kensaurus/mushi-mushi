import { useState } from 'react'
import { CodePanel } from '../CodePanel'
import { ConfigHelp } from '../ConfigHelp'
import { SegmentedControl } from '../ui'
import {
  FRAMEWORKS,
  frameworkLabel,
  isMobileFramework,
  isServerFramework,
  type Framework,
} from '../../lib/sdkSnippets'

/** Maps each framework tab to the language label on the code-panel chrome. */
export const CODE_LANG_BY_FRAMEWORK: Record<Framework, string> = {
  loader: 'html',
  react: 'tsx',
  'react-native': 'tsx',
  expo: 'tsx',
  capacitor: 'ts',
  vue: 'vue',
  svelte: 'svelte',
  vanilla: 'html',
  // Server-side: instrument files are TypeScript.
  node: 'ts',
  express: 'ts',
  fastify: 'ts',
  hono: 'ts',
}

export function SdkInstallSnippetColumn({
  framework,
  onFrameworkChange,
  autoFrameworkApplied,
  code,
  install,
}: {
  framework: Framework
  onFrameworkChange: (fw: Framework) => void
  autoFrameworkApplied: React.MutableRefObject<boolean>
  code: string
  install: string
}) {
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [installCopied, setInstallCopied] = useState(false)

  function copy(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  return (
    <div className="space-y-3 min-w-0">
      {/* Framework tabs.
          `flex-wrap` is non-negotiable: there are 7 frameworks today
          (React / Vue / Svelte / React Native / Expo / Capacitor /
          Vanilla JS) which already overflow the right-column track at
          ≤ 1024 px viewports. Without wrap the rightmost button (Vanilla
          JS) gets *clipped outside* the card border — verified at
          1440 / 1024 / 800 before this fix. `whitespace-nowrap` keeps
          "React Native" on a single line when wrapping kicks in
          (otherwise it splits into "React" / "Native" on adjacent
          lines, which the eye reads as two separate tabs). */}
      <div className="flex flex-wrap items-center gap-1 border-b border-edge-subtle pb-2">
        <SegmentedControl
          value={framework}
          options={FRAMEWORKS.map((fw) => ({ id: fw, label: frameworkLabel(fw) }))}
          onChange={(fw) => {
            autoFrameworkApplied.current = true
            onFrameworkChange(fw)
            setSnippetCopied(false)
            setInstallCopied(false)
          }}
          ariaLabel="Framework"
          size="sm"
          wrap
          scrollable
          className="min-w-0 flex-1"
        />
        <ConfigHelp helpId="sdk-install.framework" />
      </div>

      <CodePanel
        label="Install"
        language="bash"
        code={install}
        onCopy={() => copy(install, setInstallCopied)}
        copied={installCopied}
      />

      <CodePanel
        label="Code"
        language={CODE_LANG_BY_FRAMEWORK[framework]}
        code={code}
        onCopy={() => copy(code, setSnippetCopied)}
        copied={snippetCopied}
        maxHeight="max-h-72"
      />

      {/* Power-user APIs added in the 2026-05-07 SDK boost.
          Hidden by default so the install card stays scannable for
          first-timers, but a one-click expand for hosts that want
          identity/tags/breadcrumbs/Sentry-grade context. We only
          show this disclosure for the web frameworks because the
          mobile bridges (React Native / Expo / Capacitor) don't
          ship these methods yet — they'll get a per-platform
          equivalent once their wave lands. */}
      {!isMobileFramework(framework) && !isServerFramework(framework) && (
        <details className="rounded-md border border-edge-subtle bg-surface-raised/50">
          <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-3 py-2 text-xs text-fg hover:bg-surface-overlay rounded-md">
            <span className="font-medium">Power-user APIs (identity, tags, breadcrumbs, Sentry)</span>
            <span aria-hidden className="text-2xs text-fg-faint">›</span>
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-3 text-2xs text-fg-secondary">
            <p className="leading-relaxed">
              Every report carries the breadcrumb buffer, sticky tags, and (when
              Sentry is installed) the active trace + replay + user. After a
              successful submit the SDK also tags Sentry's scope with
              <code className="mushi-code-inline mx-1 font-mono">mushi.report_id</code>
              so subsequent Sentry events backlink — the admin can pivot via
              Sentry MCP without a manual paste.
            </p>
            <pre className="mushi-code-block mushi-code-body px-2.5 py-2 rounded-sm border border-code-surface-border overflow-x-auto whitespace-pre-wrap">{`// Identity — sticky across every subsequent report
Mushi.getInstance()?.identify(user.id, { email: user.email, name: user.name })

// Tags — short scalar key/values, surfaced to the Triage LLM
Mushi.getInstance()?.setTag('feature', 'checkout-v2')
Mushi.getInstance()?.setTags({ tenant: org.slug, plan: 'pro' })

// Breadcrumbs — auto-captured for routes / clicks / console.error,
// add your own for domain events the SDK can't infer
Mushi.getInstance()?.addBreadcrumb({
  category: 'custom',
  level: 'info',
  message: 'Checkout flow: payment intent created',
  data: { intentId: pi.id, amountCents: 4999 },
})

// Programmatic capture — try/catch friendly, normalises any thrown
// value (Error / string / plain object). Pairs with Sentry: same
// call-site can flush to both and the reports are auto-linked via
// sentryContext.eventId.
try {
  await checkout(cart)
} catch (err) {
  await Mushi.getInstance()?.captureException(err, {
    severity: 'high',
    component: 'CheckoutPage',
    tags: { step: 'submit-payment' },
  })
  throw err
}`}</pre>
          </div>
        </details>
      )}
    </div>
  )
}
