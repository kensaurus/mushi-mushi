import { useState } from 'react'
import { CodePanel } from '../CodePanel'
import { ConfigHelp } from '../ConfigHelp'
import { IconChevronDown, IconChevronRight } from '../icons'
import { SegmentedControl } from '../ui'
import {
  FRAMEWORKS,
  frameworkLabel,
  isMobileFramework,
  isServerFramework,
  type Framework,
} from '../../lib/sdkSnippets'

/** Maps each framework tab to the language label on the code-panel chrome. */
const CODE_LANG_BY_FRAMEWORK: Record<Framework, string> = {
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
  belowTabs,
}: {
  framework: Framework
  onFrameworkChange: (fw: Framework) => void
  autoFrameworkApplied: React.MutableRefObject<boolean>
  code: string
  install: string
  /** A choice that belongs to the picked tab (the React setup), above the code it changes. */
  belowTabs?: React.ReactNode
}) {
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [installCopied, setInstallCopied] = useState(false)
  const [showPowerApis, setShowPowerApis] = useState(false)
  // Twelve framework tabs on a fresh app (ADR 0069): the Script tag works anywhere and leads,
  // the picked one sits beside it, every other framework is in one list.
  const chips: Framework[] = framework === 'loader' ? ['loader'] : ['loader', framework]
  const others = FRAMEWORKS.filter((fw) => !chips.includes(fw))

  function pick(fw: Framework) {
    autoFrameworkApplied.current = true
    onFrameworkChange(fw)
    setSnippetCopied(false)
    setInstallCopied(false)
  }

  function copy(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  return (
    <div className="space-y-3 min-w-0">
      {/* The Script tag and the picked framework as tabs, the rest in a list. The ⓘ stays at the
          end of the row (round-3 review, 2026-11-19). */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge-subtle pb-2">
        <SegmentedControl
          value={framework}
          options={chips.map((fw) => ({ id: fw, label: frameworkLabel(fw) }))}
          onChange={pick}
          ariaLabel="Framework"
          size="sm"
        />
        <select
          aria-label="Other frameworks"
          className="h-7 min-w-0 rounded-sm border border-edge-subtle bg-surface-raised px-2 text-2xs text-fg"
          value=""
          onChange={(e) => {
            if (e.target.value) pick(e.target.value as Framework)
          }}
          data-testid="sdk-framework-other"
        >
          <option value="">Other frameworks</option>
          {others.map((fw) => (
            <option key={fw} value={fw}>
              {frameworkLabel(fw)}
            </option>
          ))}
        </select>
        <ConfigHelp helpId="sdk-install.framework" />
      </div>

      {belowTabs}

      {/* The Script tag installs nothing: no "Install" panel saying so beside the code. */}
      {framework !== 'loader' && (
        <CodePanel
          label="Install"
          language="bash"
          code={install}
          onCopy={() => copy(install, setInstallCopied)}
          copied={installCopied}
        />
      )}

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
        <div className="rounded-md border border-edge-subtle bg-surface-raised/50">
          {/* Rendered only when opened, so a fresh install card is not 150 words of example code. */}
          <button
            type="button"
            aria-expanded={showPowerApis}
            aria-controls="sdk-power-apis"
            onClick={() => setShowPowerApis((v) => !v)}
            className="flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs text-fg hover:bg-surface-overlay"
          >
            <span className="font-medium">Power-user APIs (identity, tags, breadcrumbs, Sentry)</span>
            {showPowerApis ? (
              <IconChevronDown size={12} className="text-fg-faint" />
            ) : (
              <IconChevronRight size={12} className="text-fg-faint" />
            )}
          </button>
          {showPowerApis && (
          <div id="sdk-power-apis" className="px-3 pb-3 pt-1 space-y-3 text-2xs text-fg-secondary">
            <p className="leading-relaxed">
              Every report carries the breadcrumb buffer, sticky tags, and (when
              Sentry is installed) the active trace + replay + user. After a
              successful submit the SDK also tags Sentry's scope with
              <code className="mushi-code-inline mx-1 font-mono">mushi.report_id</code>
              so subsequent Sentry events backlink — the admin can pivot via
              Sentry MCP without a manual paste.
            </p>
            <pre
              tabIndex={0}
              role="region"
              aria-label="Power-user API example"
              className="mushi-code-block mushi-code-body px-2.5 py-2 rounded-sm border border-code-surface-border overflow-x-auto whitespace-pre-wrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
            >{`// Identity — sticky across every subsequent report
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
          )}
        </div>
      )}
    </div>
  )
}
