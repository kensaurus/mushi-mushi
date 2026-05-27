/**
 * KycForm — Wave 9 compliance gate.
 *
 * Triggered automatically on TesterWalletPage when a tester's lifetime
 * gift-card redemptions approach the $400 USD threshold. Collects the
 * minimum information needed to satisfy IRS 1099 requirements while
 * keeping the UX simple.
 *
 * W-9 (US residents) / W-8BEN (non-US individuals) / W-8BEN-E (non-US entities).
 * TIN is HMAC'd server-side with TESTER_TIN_PEPPER before storage — never stored in plaintext.
 * Tax form PDFs are handled out-of-band; this form collects metadata only.
 *
 * Marketing copy guardrail (Wave 0 legal review): gift-card UI uses
 * "100+ rewards including Amazon" — never "earn Amazon gift cards".
 */
import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Card, Input, Section } from '../ui'

type TaxFormKind = 'W9' | 'W8BEN' | 'W8BEN-E' | 'none'

interface KycFormProps {
  /** Tester's country_code from mushi_testers — drives form type selection. */
  countryCode: string | null
  /** Called when KYC is successfully submitted so the parent can re-fetch status. */
  onSubmitted: () => void
}

const FORM_BY_COUNTRY: Record<string, TaxFormKind> = {
  US: 'W9',
}

function detectFormKind(countryCode: string | null): TaxFormKind {
  if (!countryCode) return 'W8BEN'
  return FORM_BY_COUNTRY[countryCode.toUpperCase()] ?? 'W8BEN'
}

export function KycForm({ countryCode, onSubmitted }: KycFormProps) {
  const toast = useToast()
  const formKind = detectFormKind(countryCode)

  const [legalName, setLegalName] = useState('')
  const [tin, setTin] = useState('')
  const [jurisdiction, setJurisdiction] = useState(countryCode ?? '')
  const [entityType, setEntityType] = useState<'individual' | 'entity'>('individual')
  const [submitting, setSubmitting] = useState(false)
  const [agreed, setAgreed] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agreed) { toast.error('Please confirm the declaration before submitting.'); return }
    if (!legalName.trim()) { toast.error('Legal name is required.'); return }
    if (!tin.trim()) { toast.error('TIN / SSN / EIN is required.'); return }

    setSubmitting(true)
    try {
      await apiFetch('/v1/tester/kyc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jurisdiction,
          taxFormKind: formKind,
          legalName,
          tin: tin.trim(),
        }),
      })

      toast.success('KYC information submitted. Redemptions will resume after review (typically < 1 business day).')
      onSubmitted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'KYC submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <Section title={`Tax information required (${formKind})`}>
        <p className="text-2xs text-fg-muted mb-4">
          {formKind === 'W9'
            ? 'US law requires we collect a W-9 before cumulative rewards exceed $400 USD. Your TIN is encrypted in transit and stored only as a one-way HMAC — we never persist plaintext.'
            : `Non-US recipients must complete a ${formKind} before cumulative rewards exceed $400 USD. Your TIN is encrypted in transit and stored only as a one-way HMAC — we never persist plaintext.`}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">
              Legal name (as appears on tax documents)
            </label>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Full legal name or entity name"
              required
            />
          </div>

          {formKind === 'W8BEN-E' && (
            <div>
              <label className="block text-xs font-medium text-fg-secondary mb-1">
                Entity type
              </label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as 'individual' | 'entity')}
                className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                <option value="individual">Individual</option>
                <option value="entity">Business / Entity</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">
              {formKind === 'W9' ? 'SSN or EIN' : 'Foreign TIN'}
            </label>
            <Input
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              placeholder={formKind === 'W9' ? '9-digit SSN or EIN' : 'Foreign tax ID number'}
              type="password"
              autoComplete="off"
              required
            />
            <p className="mt-1 text-2xs text-fg-faint">
              Transmitted over HTTPS. Hashed server-side with a secret key — never stored in plaintext.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-secondary mb-1">
              Country / jurisdiction
            </label>
            <Input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="e.g. US, GB, JP"
              maxLength={2}
            />
          </div>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 flex-shrink-0"
            />
            <span className="text-xs text-fg-secondary">
              I certify that the information above is accurate and that I am the
              beneficial owner (or authorized representative) of the tax ID provided.
              I understand this information is used solely for IRS / international
              tax compliance purposes.
            </span>
          </label>

          <Btn
            type="submit"
            variant="primary"
            disabled={submitting || !agreed}
          >
            {submitting ? 'Submitting…' : 'Submit tax information'}
          </Btn>

          <p className="text-2xs text-fg-faint">
            Rewards will resume within 1 business day after verification.
            You will receive an email confirmation.
          </p>
        </form>
      </Section>
    </Card>
  )
}
