/**
 * TesterSettingsPage — manage tester profile: handle, bio, expertise tags, KYC, data export/delete.
 */
import { useState, useEffect } from 'react'
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../../components/ui'
import { Modal } from '../../components/Modal'
import { ContainedBlock } from '../../components/report-detail/ReportSurface'
import { KycForm } from '../../components/tester/KycForm'

const EXPERTISE_OPTIONS = [
  'web', 'ios', 'android', 'accessibility', 'security',
  'performance', 'i18n', 'ux', 'api', 'desktop',
]

interface TesterProfile {
  handle: string | null
  bio: string | null
  expertiseTags: string[]
  country: string | null
  kycStatus: 'none' | 'pending' | 'cleared' | 'rejected'
  kycClearedAt: string | null
  privacyPublicHandle: boolean
  privacyPublicLeaderboard: boolean
}

export function TesterSettingsPage() {
  const { data: profile, loading, reload } = usePageData<TesterProfile>('/v1/tester/me')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [form, setForm] = useState<Partial<TesterProfile>>({})
  const [feedback, setFeedback] = useState({ subject: '', body: '' })
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    if (profile) setForm(profile)
  }, [profile])

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiFetch('/v1/tester/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      reload()
    } catch {
      // handled by apiFetch toast
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    const blob = await apiFetch('/v1/tester/export', { method: 'POST' })
    const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'mushi-tester-data.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiFetch('/v1/tester/delete', { method: 'POST' })
      window.location.href = '/login'
    } catch {
      setDeleting(false)
    }
  }

  const handleSendFeedback = async () => {
    if (feedback.subject.trim().length < 3 || feedback.body.trim().length < 10) return
    setFeedbackState('sending')
    try {
      await apiFetch('/v1/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...feedback, category: 'other' }),
      })
      setFeedbackState('sent')
      setFeedback({ subject: '', body: '' })
    } catch {
      setFeedbackState('error')
    }
  }

  const toggleTag = (tag: string) => {
    const current = form.expertiseTags ?? []
    setForm(f => ({
      ...f,
      expertiseTags: current.includes(tag)
        ? current.filter(t => t !== tag)
        : [...current, tag],
    }))
  }

  return (
    <TesterLayout>
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-lg font-bold">Profile Settings</h1>
          <p className="text-sm text-fg-muted mt-0.5">Manage your tester identity and privacy.</p>
        </div>

        {loading && <div className="h-64 rounded-lg bg-surface animate-pulse" />}

        {!loading && form && (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Public profile</h2>

              <div>
                <label className="block text-2xs text-fg-muted mb-1">Handle</label>
                <input
                  placeholder="your-handle"
                  value={form.handle ?? ''}
                  onChange={e => setForm(f => ({ ...f, handle: e.target.value }))}
                  className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
                <p className="text-2xs text-fg-faint mt-1">Shown on the public leaderboard. No spaces.</p>
              </div>

              <div>
                <label className="block text-2xs text-fg-muted mb-1">Bio</label>
                <textarea
                  placeholder="Tell developers what you test for…"
                  rows={2}
                  value={form.bio ?? ''}
                  onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                  className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
                />
              </div>

              <div>
                <label className="block text-2xs text-fg-muted mb-2">Expertise tags</label>
                <div className="flex flex-wrap gap-2">
                  {EXPERTISE_OPTIONS.map(tag => {
                    const selected = (form.expertiseTags ?? []).includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full border px-3 py-1 text-2xs font-medium motion-safe:transition-colors ${
                          selected
                            ? 'border-brand/60 bg-brand/10 text-brand'
                            : 'border-edge text-fg-muted hover:border-edge-strong'
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-2xs text-fg-muted mb-1">Country</label>
                <input
                  placeholder="e.g. US, JP, TH"
                  value={form.country ?? ''}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  maxLength={2}
                  className="w-28 rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Privacy</h2>
              <label className="flex items-center gap-2 text-2xs text-fg-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.privacyPublicHandle ?? true}
                  onChange={e => setForm(f => ({ ...f, privacyPublicHandle: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand"
                />
                Show my handle on the public tester leaderboard
              </label>
              <label className="flex items-center gap-2 text-2xs text-fg-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.privacyPublicLeaderboard ?? true}
                  onChange={e => setForm(f => ({ ...f, privacyPublicLeaderboard: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand"
                />
                Include my stats in the 30-day leaderboard
              </label>
            </section>

            {/* KYC status */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold" id="kyc">Identity verification (KYC)</h2>
              {profile?.kycStatus === 'cleared' ? (
                <ContainedBlock tone="info">
                  <p className="text-xs font-medium">✓ Identity verified</p>
                  <p className="text-2xs text-fg-muted mt-0.5">Gift card redemptions up to $599/yr are unlocked.</p>
                </ContainedBlock>
              ) : profile?.kycStatus === 'pending' ? (
                <ContainedBlock tone="info">
                  <p className="text-xs font-medium">Verification in progress</p>
                  <p className="text-2xs text-fg-muted mt-0.5">
                    Typically clears within 2 business days.
                  </p>
                </ContainedBlock>
              ) : (
                <div className="space-y-3">
                  <ContainedBlock tone="muted">
                    <p className="text-xs text-fg-secondary">
                      Identity verification (W-9 or W-8BEN) is required once your gift-card redemptions
                      reach $400 in a calendar year. You can also complete it proactively.
                    </p>
                  </ContainedBlock>
                  <KycForm
                    countryCode={profile?.country ?? null}
                    onSubmitted={() => reload()}
                  />
                </div>
              )}
            </section>

            <Btn onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Btn>

            <hr className="border-edge" />

            {/* Tester → Mushi feedback channel */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Send feedback about Mushi Bounties</h2>
              <p className="text-2xs text-fg-secondary">
                Found a bug in the platform itself? Have a suggestion? Let us know — this goes directly to the Mushi team.
              </p>
              {feedbackState === 'sent' ? (
                <ContainedBlock tone="info">
                  <p className="text-xs font-medium">✓ Feedback sent</p>
                  <p className="text-2xs text-fg-muted mt-0.5">We usually respond within 2 business days.</p>
                </ContainedBlock>
              ) : (
                <div className="space-y-2">
                  <input
                    placeholder="Subject (e.g. Bug: wallet balance incorrect)"
                    value={feedback.subject}
                    onChange={e => setFeedback(f => ({ ...f, subject: e.target.value }))}
                    className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                  <textarea
                    placeholder="Describe the issue or suggestion in detail…"
                    rows={3}
                    value={feedback.body}
                    onChange={e => setFeedback(f => ({ ...f, body: e.target.value }))}
                    className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
                  />
                  {feedbackState === 'error' && (
                    <p className="text-2xs text-danger">Failed to send. Please try again.</p>
                  )}
                  <Btn
                    onClick={handleSendFeedback}
                    disabled={feedbackState === 'sending' || feedback.subject.trim().length < 3 || feedback.body.trim().length < 10}
                  >
                    {feedbackState === 'sending' ? 'Sending…' : 'Send feedback'}
                  </Btn>
                </div>
              )}
            </section>

            <hr className="border-edge" />

            {/* GDPR data controls */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-fg-muted">Data & privacy</h2>
              <p className="text-2xs text-fg-secondary">
                Under GDPR and CCPA, you can download a copy of your data or permanently delete your tester account.
              </p>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={handleExport}>
                  Download my data
                </Btn>
                <Btn
                  variant="ghost"
                  className="text-danger border-danger/30 hover:bg-danger/10"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete account
                </Btn>
              </div>
            </section>

            <Modal
              open={showDeleteConfirm}
              onClose={() => setShowDeleteConfirm(false)}
              title={<span className="text-danger">Delete tester account?</span>}
              footer={
                <div className="flex gap-2">
                  <Btn variant="ghost" className="flex-1 justify-center" onClick={() => setShowDeleteConfirm(false)}>
                    Cancel
                  </Btn>
                  <Btn
                    variant="danger"
                    className="flex-1 justify-center"
                    disabled={deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? 'Deleting…' : 'Delete permanently'}
                  </Btn>
                </div>
              }
            >
              <p className="text-2xs text-fg-secondary">
                This permanently deletes your tester profile, submission history, and unredeemed balance.
                This action cannot be undone. Any pending redemptions will be cancelled.
              </p>
            </Modal>
          </>
        )}
      </div>
    </TesterLayout>
  )
}
