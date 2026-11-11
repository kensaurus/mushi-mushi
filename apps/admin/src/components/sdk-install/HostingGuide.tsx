/**
 * FILE: apps/admin/src/components/sdk-install/HostingGuide.tsx
 * PURPOSE: "Where does your app run?" under the install snippet (console
 *          audit 2026-11-11, finding 5): the step that decides whether the
 *          report button reaches the LIVE app. Lovable and Bolt get the
 *          paste-ready prompt (and the Script tag tab); Vercel, Netlify and
 *          EAS get the env var names, their values once a key is on the
 *          page, and where they go. Logic in lib/hostingEnvHint.ts.
 */

import { useState } from 'react'
import { CodePanel } from '../CodePanel'
import { Card, SegmentedControl } from '../ui'
import { HOST_LABEL, HOSTS, hostGuide, type Host } from '../../lib/hostingEnvHint'

interface Props {
  projectId: string
  /** The full key when the page holds it; null until one is made. */
  apiKey: string | null
  /** What the snippet above reads its values from; null when it holds them inline. */
  bundler?: 'vite' | 'next' | null
  /** React tab with no setup picked yet: the guide asks instead of guessing. */
  askSetup?: boolean
  /** Lovable / Bolt: switch the snippet to the Script tag tab. */
  onUseScriptTag?: () => void
  /** Pre-pick a host (the user came from the landing's Lovable tab). */
  initialHost?: Host | null
  /** The snippet above is the Script tag: nothing goes in the host's settings. */
  scriptTag?: boolean
}

export function HostingGuide({ projectId, apiKey, bundler, askSetup = false, onUseScriptTag, initialHost = null, scriptTag = false }: Props) {
  const [host, setHost] = useState<Host | null>(initialHost)
  const [copied, setCopied] = useState(false)
  const guide = host ? hostGuide(host, { projectId, apiKey, bundler, askSetup, scriptTag }) : null

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card className="space-y-2 p-3" data-testid="hosting-guide">
      <div>
        <p className="text-xs font-semibold text-fg">Where does your app run?</p>
        <p className="text-2xs text-fg-muted">
          The report button only reaches your users once it is in the live app. Pick your host to see where the
          key goes.
        </p>
      </div>
      <SegmentedControl<Host>
        value={host ?? ('' as Host)}
        options={HOSTS.map((h) => ({ id: h, label: HOST_LABEL[h] }))}
        onChange={(h) => {
          setHost(h)
          setCopied(false)
          if (h === 'lovable' || h === 'bolt') onUseScriptTag?.()
        }}
        ariaLabel="Where your app runs"
        size="sm"
        wrap
      />
      {guide && (
        <div className="space-y-2" data-testid={`hosting-guide-${host}`}>
          <p className="text-xs text-fg-secondary">{guide.lead}</p>
          {guide.prompt && (
            <CodePanel label={`Paste into ${HOST_LABEL[host!]}`} language="html" code={guide.prompt} onCopy={() => copy(guide.prompt!)} copied={copied} />
          )}
          {guide.envBlock ? (
            <CodePanel label="Names and values" language="bash" code={guide.envBlock} onCopy={() => copy(guide.envBlock!)} copied={copied} />
          ) : guide.envNames && (
            <ul className="space-y-0.5" aria-label="Environment variable names">
              {guide.envNames.map((n) => (
                <li key={n}>
                  <code className="mushi-code-inline font-mono text-2xs">{n}</code>
                </li>
              ))}
            </ul>
          )}
          {guide.steps.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-5 text-2xs text-fg-secondary">
              {guide.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {guide.link && (
            <a href={guide.link.href} target="_blank" rel="noreferrer" className="text-2xs text-brand underline underline-offset-2">
              {guide.link.label} ↗
            </a>
          )}
        </div>
      )}
    </Card>
  )
}
