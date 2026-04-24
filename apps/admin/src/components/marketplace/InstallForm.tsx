/**
 * FILE: apps/admin/src/components/marketplace/InstallForm.tsx
 * PURPOSE: Inline form for installing a marketplace plugin. The page owns
 *          form state + submission so the secret can be regenerated and
 *          validation messages routed through useToast.
 */

import { Btn, Input, Section } from '../ui'
import type { MarketplacePlugin } from './types'
import { httpsUrl, token } from '../../lib/validators'

interface Props {
  target: MarketplacePlugin
  webhookUrl: string
  webhookSecret: string
  events: string
  installing: boolean
  onWebhookUrlChange: (v: string) => void
  onWebhookSecretChange: (v: string) => void
  onEventsChange: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function InstallForm({
  target,
  webhookUrl,
  webhookSecret,
  events,
  installing,
  onWebhookUrlChange,
  onWebhookSecretChange,
  onEventsChange,
  onCancel,
  onSubmit,
}: Props) {
  return (
    <Section title={`Install ${target.name}`} className="space-y-3">
      <p className="text-2xs opacity-70">
        Subscribed events:&nbsp;
        <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
          {(target.manifest?.subscribes ?? []).join(', ') || '(none)'}
        </code>
      </p>
      <Input
        label="Webhook URL"
        helpId="marketplace.plugin_webhook_url"
        value={webhookUrl}
        placeholder="https://your-receiver.example.com/mushi/webhook"
        onChange={(e) => onWebhookUrlChange(e.target.value)}
        validate={httpsUrl({ optional: false })}
      />
      <Input
        label="Signing secret (HMAC-SHA256, store this — shown only once)"
        helpId="marketplace.plugin_signing_secret"
        value={webhookSecret}
        onChange={(e) => onWebhookSecretChange(e.target.value)}
        validate={token({ minLength: 32, optional: false })}
      />
      <Input
        label="Subscribed events (comma-separated, * for all)"
        helpId="marketplace.subscribed_events"
        value={events}
        onChange={(e) => onEventsChange(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Btn>
        <Btn size="sm" onClick={onSubmit} disabled={installing} loading={installing}>
          Install
        </Btn>
      </div>
    </Section>
  )
}
