/**
 * FILE: apps/admin/src/components/voice/PushNotifyCard.tsx
 * PURPOSE: "Notify this device" — Web Push subscribe / test / stop for the
 *          signed-in user (plan C5 "Developer Web Push"). The permission
 *          prompt is triggered from the tap (iOS requirement); on iOS in
 *          Safari (not installed) it explains the Add-to-Home-Screen step.
 */

import { useEffect, useState } from 'react'
import { Btn, Section } from '../ui'
import { ResultChip, type ResultChipTone } from '../ui'
import { InlineProof, SignalChip } from '../report-detail/ReportSurface'
import { IconBell } from '../icons'
import {
  PUSH_UNSUPPORTED_COPY,
  detectPushSupportInBrowser,
  getCurrentPushSubscription,
  isIos,
  isStandalone,
  pushServiceLabel,
  sendTestPush,
  subscribeToPush,
  summarise,
  unsubscribeFromPush,
  type PushSubscriptionSummary,
} from '../../lib/pwa'

interface PushNotifyCardProps {
  /** Compact variant for the Settings card. */
  compact?: boolean
}

export function PushNotifyCard({ compact }: PushNotifyCardProps) {
  const [support] = useState(() => (typeof window === 'undefined' ? null : detectPushSupportInBrowser()))
  const [current, setCurrent] = useState<PushSubscriptionSummary | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState<'subscribe' | 'test' | 'unsubscribe' | null>(null)
  const [result, setResult] = useState<{ tone: ResultChipTone; text: string; at: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCurrentPushSubscription().then((sub) => {
      if (cancelled) return
      setCurrent(sub ? summarise(sub.endpoint) : null)
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const note = (tone: ResultChipTone, text: string) => setResult({ tone, text, at: new Date().toISOString() })

  async function subscribe() {
    setBusy('subscribe')
    setResult(null)
    const res = await subscribeToPush()
    setBusy(null)
    if (res.ok) {
      setCurrent(res.subscription)
      note('success', `This device will get pushes via ${pushServiceLabel(res.subscription.host)}.`)
    } else {
      note('error', res.message)
    }
  }

  async function test() {
    setBusy('test')
    setResult(null)
    const res = await sendTestPush()
    setBusy(null)
    if (res.ok) note('success', `Test sent to ${res.sent ?? 1} device${(res.sent ?? 1) === 1 ? '' : 's'} — check the notification shade.`)
    else note('error', res.message ?? 'Test failed')
  }

  async function stop() {
    setBusy('unsubscribe')
    setResult(null)
    const res = await unsubscribeFromPush()
    setBusy(null)
    if (res.ok) {
      setCurrent(null)
      note('info', 'This device will no longer receive pushes.')
    } else {
      note('error', res.message ?? 'Could not unsubscribe')
    }
  }

  const iosNeedsInstall = support && !support.supported && support.reason === 'ios_not_standalone'
  const unsupportedCopy = support && !support.supported ? PUSH_UNSUPPORTED_COPY[support.reason] : null
  const permissionDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  const iosInstalled = typeof window !== 'undefined' && isIos() && isStandalone()

  const body = (
    <div className="space-y-2.5">
      <p className="text-xs text-fg-secondary">
        Get a push on this device when the transcript needs a confirmation, when the draft PR opens, or when a fix fails.
      </p>

      {unsupportedCopy && (
        <SignalChip tone={iosNeedsInstall ? 'warn' : 'neutral'} className="whitespace-normal">
          {unsupportedCopy}
        </SignalChip>
      )}
      {permissionDenied && !current && (
        <SignalChip tone="warn" className="whitespace-normal">
          Notifications are blocked for this site in the browser settings.
        </SignalChip>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <>
            <InlineProof>Subscribed · {pushServiceLabel(current.host)}</InlineProof>
            <Btn variant="ghost" size="sm" onClick={() => void test()} loading={busy === 'test'} disabled={busy !== null} title="Send a test notification to every device you subscribed">
              Send test
            </Btn>
            <Btn variant="cancel" size="sm" onClick={() => void stop()} loading={busy === 'unsubscribe'} disabled={busy !== null} title="Stop pushes on this device">
              Stop
            </Btn>
          </>
        ) : (
          <Btn
            variant="primary"
            size="sm"
            onClick={() => void subscribe()}
            loading={busy === 'subscribe' || checking}
            disabled={busy !== null || checking || Boolean(unsupportedCopy)}
            title={unsupportedCopy ?? 'Allow notifications and register this device'}
            leadingIcon={<IconBell className="h-3.5 w-3.5" />}
            data-testid="push-subscribe"
          >
            Notify this device
          </Btn>
        )}
        {iosInstalled && !current && <InlineProof>Home Screen app detected</InlineProof>}
      </div>

      {result && (
        <ResultChip tone={result.tone} at={result.at}>
          {result.text}
        </ResultChip>
      )}
    </div>
  )

  if (compact) return body
  return (
    <Section title="Push to this phone" icon={<IconBell className="h-4 w-4" />}>
      {body}
    </Section>
  )
}
