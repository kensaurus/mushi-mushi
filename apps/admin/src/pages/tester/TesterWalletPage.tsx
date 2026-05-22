/**
 * TesterWalletPage — view mushi-point balance, redemption history, and redeem rewards.
 * Redemption options: Mushi Pro credit (1.3× premium) or gift cards via Tremendous.
 */
import { useState } from 'react'
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../../components/ui'
import { ContainedBlock } from '../../components/report-detail/ReportSurface'

interface WalletData {
  balance: number
  totalEarned: number
  totalRedeemed: number
  ytdGiftCardUsd: number
  kycRequired: boolean
  kycCleared: boolean
  recentLedger: LedgerEntry[]
  catalog: RewardOption[]
}

interface LedgerEntry {
  id: string
  type: 'credit' | 'debit'
  points: number
  reason: string
  createdAt: string
}

interface RewardOption {
  id: string
  name: string
  description: string
  pointsCost: number
  valueUsd: number
  category: 'pro' | 'giftcard'
  icon: string
  isAvailable: boolean
  unavailableReason?: string
}

export function TesterWalletPage() {
  const { data: wallet, loading, reload } = usePageData<WalletData>('/v1/tester/wallet')
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<RewardOption | null>(null)

  const handleRedeem = async (option: RewardOption) => {
    setConfirming(null)
    setRedeeming(option.id)
    try {
      await apiFetch('/v1/tester/wallet/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogItemId: option.id }),
      })
      reload()
    } catch {
      // error handled by apiFetch toast
    } finally {
      setRedeeming(null)
    }
  }

  return (
    <TesterLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-bold">Wallet & Rewards</h1>
          <p className="text-sm text-fg-muted mt-0.5">
            Redeem your mushi-points for Mushi Pro credit or gift cards.
          </p>
        </div>

        {loading && (
          <div className="h-32 rounded-lg bg-surface animate-pulse" />
        )}

        {!loading && wallet && (
          <>
            {/* Balance card */}
            <div className="rounded-xl border border-brand/30 bg-gradient-to-br from-brand/10 to-transparent p-5">
              <p className="text-2xs text-fg-muted">Current balance</p>
              <p className="text-3xl font-bold mt-1">{wallet.balance.toLocaleString()}</p>
              <p className="text-sm text-fg-muted">mushi-points</p>
              <div className="flex gap-4 mt-3 text-2xs text-fg-secondary">
                <span>Total earned: {wallet.totalEarned.toLocaleString()} pts</span>
                <span>Total redeemed: {wallet.totalRedeemed.toLocaleString()} pts</span>
              </div>
            </div>

            {/* KYC alert */}
            {wallet.kycRequired && !wallet.kycCleared && (
              <ContainedBlock tone="warn">
                <p className="text-xs font-medium">Identity verification required</p>
                <p className="text-2xs text-fg-muted mt-1">
                  Your gift-card redemptions have reached ${wallet.ytdGiftCardUsd.toFixed(2)} this year.
                  You need to complete W-9 / W-8BEN verification before redeeming further gift cards.
                  Mushi Pro credit redemptions are always available.
                </p>
                <a
                  href="/tester/settings#kyc"
                  className="mt-2 inline-block text-2xs text-brand hover:text-brand-hover motion-safe:transition-colors"
                >
                  Complete verification →
                </a>
              </ContainedBlock>
            )}

            {/* Confirm dialog */}
            {confirming && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-sm rounded-xl border border-edge bg-surface p-5 space-y-4 shadow-2xl">
                  <div className="text-center">
                    <p className="text-2xl">{confirming.icon}</p>
                    <h3 className="text-sm font-semibold mt-2">Confirm redemption</h3>
                    <p className="text-2xs text-fg-muted mt-1">{confirming.name}</p>
                  </div>
                  <div className="rounded-md bg-surface-root p-3 text-center">
                    <p className="text-xs text-fg-secondary">
                      {confirming.pointsCost.toLocaleString()} mushi-points
                      {confirming.category === 'giftcard' && (
                        <> → <span className="font-medium text-fg">${confirming.valueUsd} gift card</span></>
                      )}
                      {confirming.category === 'pro' && (
                        <> → <span className="font-medium text-ok">${confirming.valueUsd} Mushi Pro credit (30% bonus)</span></>
                      )}
                    </p>
                  </div>
                  {confirming.category === 'giftcard' && (
                    <p className="text-2xs text-fg-faint text-center">
                      Gift card value is taxable income at fair market value.
                      Tremendous files the 1099-MISC. $599/yr cap before KYC.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn variant="ghost" className="flex-1 justify-center" onClick={() => setConfirming(null)}>
                      Cancel
                    </Btn>
                    <Btn
                      className="flex-1 justify-center"
                      disabled={redeeming === confirming.id}
                      onClick={() => handleRedeem(confirming)}
                    >
                      {redeeming === confirming.id ? 'Redeeming…' : 'Confirm'}
                    </Btn>
                  </div>
                </div>
              </div>
            )}

            {/* Reward catalog */}
            <div>
              <h2 className="text-sm font-semibold mb-3">Redeem rewards</h2>
              {(!wallet.catalog || wallet.catalog.length === 0) ? (
                <p className="text-2xs text-fg-muted">No reward options available yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {wallet.catalog.map((option) => (
                    <div
                      key={option.id}
                      className={`rounded-lg border p-4 flex items-start gap-3 ${
                        option.isAvailable
                          ? 'border-edge bg-surface hover:border-brand/40 motion-safe:transition-colors'
                          : 'border-edge bg-surface opacity-60'
                      }`}
                    >
                      <span className="text-2xl shrink-0">{option.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{option.name}</p>
                        <p className="text-2xs text-fg-muted mt-0.5">{option.description}</p>
                        <p className="text-2xs text-fg-secondary mt-1">
                          {option.pointsCost.toLocaleString()} pts → ${option.valueUsd}
                          {option.category === 'pro' && (
                            <span className="ml-1 text-ok font-medium">+30% bonus</span>
                          )}
                        </p>
                        {!option.isAvailable && option.unavailableReason && (
                          <p className="text-2xs text-fg-faint mt-0.5">{option.unavailableReason}</p>
                        )}
                      </div>
                      <Btn
                        size="sm"
                        disabled={!option.isAvailable || wallet.balance < option.pointsCost || !!redeeming}
                        onClick={() => setConfirming(option)}
                        className="shrink-0"
                      >
                        Redeem
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent ledger */}
            {wallet.recentLedger && wallet.recentLedger.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3">Recent activity</h2>
                <div className="rounded-lg border border-edge divide-y divide-edge overflow-hidden">
                  {wallet.recentLedger.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface">
                      <div className="min-w-0">
                        <p className="text-xs truncate">{entry.reason}</p>
                        <p className="text-2xs text-fg-faint">{new Date(entry.createdAt).toLocaleDateString()}</p>
                      </div>
                      <p className={`text-sm font-medium shrink-0 ${entry.type === 'credit' ? 'text-ok' : 'text-fg-muted'}`}>
                        {entry.type === 'credit' ? '+' : '−'}{Math.abs(entry.points).toLocaleString()} pts
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </TesterLayout>
  )
}
