/**
 * TesterWalletPage — balance, milestone strip, redemption catalog, and ledger.
 * Enhancements over v1:
 * - Always-on $0/$400/$599 segmented progress bar (replaces conditional yellow banner)
 * - Conversion preview per catalog item (pts × multiplier = $value · ETA)
 * - Pending redemptions card showing in-flight rewards
 * - Lifetime stats sub-section
 */
import { useState } from 'react'
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Badge, Card } from '../../components/ui'
import { TableSkeleton } from '../../components/skeletons/TableSkeleton'

interface CatalogItem {
  id: string
  name: string
  description: string
  pointsCost: number
  valueUsd: number
  category: 'pro' | 'giftcard'
  icon: string
  isAvailable: boolean
  unavailableReason?: string
  etaHours: number | null
  conversionPreview: string
}

interface LedgerEntry {
  id: string
  type: 'credit' | 'debit'
  points: number
  reason: string
  createdAt: string
}

interface PendingRedemption {
  id: string
  kind: string
  pointsSpent: number
  faceValueUsd: number | null
  status: string
  requestedAt: string
  processedAt: string | null
}

interface WalletData {
  balance: number
  totalEarned: number
  totalRedeemed: number
  ytdGiftCardUsd: number
  kycThresholdUsd: number
  kycCapUsd: number
  kycRequired: boolean
  kycCleared: boolean
  nextRedemptionEtaHours: number | null
  pendingRedemptions: PendingRedemption[]
  recentLedger: LedgerEntry[]
  catalog: CatalogItem[]
}

interface WalletResponse {
  ok: boolean
  data: WalletData
}

const LEDGER_REASON_LABEL: Record<string, string> = {
  submission_accepted: 'Report accepted',
  redemption: 'Points redeemed',
  reversal: 'Points refunded',
  bonus: 'Bonus points',
}

function MilestoneBar({ ytd, threshold, cap, kycCleared }: {
  ytd: number; threshold: number; cap: number; kycCleared: boolean
}) {
  const thresholdPct = (threshold / cap) * 100
  const ytdPct = Math.min(100, (ytd / cap) * 100)
  const overThreshold = ytd >= threshold

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-semibold">Gift card milestone</p>
          <p className="text-xs text-fg-muted mt-0.5">
            ${ytd.toFixed(0)} redeemed this year
            {overThreshold && !kycCleared && ' · identity verification required'}
            {overThreshold && kycCleared && ' · KYC cleared ✓'}
            {!overThreshold && ` · ${(threshold - ytd).toFixed(0)} until KYC required`}
          </p>
        </div>
        {overThreshold && !kycCleared && (
          <a
            href="/tester/settings#kyc"
            className="shrink-0 rounded-lg bg-warn/20 border border-warn/30 px-3 py-1.5 text-xs font-medium text-warn hover:bg-warn/30 transition-colors"
          >
            Complete KYC →
          </a>
        )}
      </div>
      {/* Segmented bar */}
      <div className="relative h-3 rounded-full bg-white/10 overflow-visible">
        {/* Filled portion */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${
            overThreshold && !kycCleared ? 'bg-warn' : 'bg-accent'
          }`}
          style={{ width: `${ytdPct}%` }}
        />
        {/* KYC gate marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white/40"
          style={{ left: `${thresholdPct}%` }}
          title={`KYC required at $${threshold}`}
        />
      </div>
      <div className="flex justify-between text-2xs text-fg-faint mt-1.5">
        <span>$0</span>
        <span className="text-warn/80">${threshold} · KYC gate</span>
        <span>${cap} annual cap</span>
      </div>
    </div>
  )
}

function PendingRedemptionCard({ r }: { r: PendingRedemption }) {
  const icon = r.kind === 'mushi_pro_credit' ? '🚀' : '🎁'
  const label = r.kind === 'mushi_pro_credit'
    ? 'Mushi Pro credit'
    : `Gift card — $${r.faceValueUsd?.toFixed(0) ?? '?'}`
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5 first:border-t-0">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-fg-faint mt-0.5">
          {r.pointsSpent.toLocaleString()} pts · requested {new Date(r.requestedAt).toLocaleDateString()}
        </p>
      </div>
      <Badge className={`text-2xs ${r.status === 'processing' ? 'bg-info/15 border-info/30 text-info' : 'bg-surface-overlay/40 border-edge/30 text-fg-muted'} border`}>
        {r.status === 'processing' ? 'Processing' : 'Pending'}
      </Badge>
    </div>
  )
}

export function TesterWalletPage() {
  const toast = useToast()
  const { data: raw, loading, error, reload } = usePageData<WalletResponse | WalletData>('/v1/tester/wallet')
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  // Normalise nested .data wrapper
  const wallet: WalletData | null = raw
    ? ('data' in raw && raw.data ? (raw as WalletResponse).data : raw as unknown as WalletData)
    : null

  async function handleRedeem(item: CatalogItem) {
    if (!wallet) return
    if (wallet.balance < item.pointsCost) {
      toast.error(`You need ${item.pointsCost.toLocaleString()} pts but only have ${wallet.balance.toLocaleString()}.`)
      return
    }
    if (item.category === 'giftcard' && wallet.kycRequired && !wallet.kycCleared) {
      window.location.href = '/tester/settings#kyc'
      return
    }
    setRedeeming(item.id)
    try {
      const res = await apiFetch('/v1/tester/wallet/redeem', {
        method: 'POST',
        body: JSON.stringify({ catalogItemId: item.id }),
      })
      if ((res as { ok?: boolean }).ok) {
        toast.success(`Redemption submitted! ${item.category === 'pro' ? 'Credit applied to your subscription.' : 'Gift card will arrive via email.'}`)
        reload()
      } else {
        const code = (res as { error?: { code?: string; message?: string } }).error?.code
        const msg  = (res as { error?: { code?: string; message?: string } }).error?.message ?? 'Redemption failed.'
        if (code === 'kyc_required') {
          toast.error('Identity verification required. Redirecting to Settings…')
          window.location.href = '/tester/settings#kyc'
        } else if (code === 'region_not_supported') {
          toast.error('Gift cards are not available in your region.')
        } else {
          toast.error(msg)
        }
      }
    } finally {
      setRedeeming(null)
    }
  }

  return (
    <TesterLayout title="Wallet">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Wallet</h1>
          <p className="text-sm text-fg-muted mt-1">
            Redeem mushi-points for Mushi Pro credit (1.3× bonus) or gift cards via Tremendous.
          </p>
        </div>

        {loading && <TableSkeleton rows={6} />}

        {error && (
          <p className="text-sm text-danger">
            {error.includes('not_a_tester')
              ? 'You need a tester account to view your wallet.'
              : `Error: ${error}`}
          </p>
        )}

        {!loading && wallet && (
          <>
            {/* Balance strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Balance',       value: wallet.balance.toLocaleString() + ' pts',                             sub: 'available to redeem' },
                { label: 'Total earned',  value: wallet.totalEarned.toLocaleString() + ' pts',                        sub: 'all time' },
                { label: 'Total redeemed',value: Math.max(0, wallet.totalRedeemed).toLocaleString() + ' pts',         sub: 'all time' },
                { label: 'YTD gift cards',value: '$' + wallet.ytdGiftCardUsd.toFixed(2),                              sub: `of $${wallet.kycCapUsd} annual cap` },
              ].map(({ label, value, sub }) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
                  <p className="text-xs text-fg-faint uppercase tracking-wide">{label}</p>
                  <p className="text-lg font-bold mt-1">{value}</p>
                  <p className="text-xs text-fg-faint mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Always-on milestone bar */}
            <MilestoneBar
              ytd={wallet.ytdGiftCardUsd}
              threshold={wallet.kycThresholdUsd ?? 400}
              cap={wallet.kycCapUsd ?? 599}
              kycCleared={wallet.kycCleared}
            />

            {/* Pending redemptions */}
            {wallet.pendingRedemptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-2">In-flight redemptions</h2>
                <Card>
                  <div className="divide-y divide-white/5">
                    {wallet.pendingRedemptions.map(r => <PendingRedemptionCard key={r.id} r={r} />)}
                  </div>
                </Card>
              </div>
            )}

            {/* Catalog */}
            <div>
              <h2 className="text-sm font-semibold mb-3">Redeem points</h2>
              <div className="space-y-2">
                {wallet.catalog.map(item => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${
                      item.isAvailable
                        ? hoveredItem === item.id
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-white/10 bg-white/5'
                        : 'border-white/5 bg-white/2 opacity-60'
                    }`}
                    onMouseEnter={() => setHoveredItem(item.id)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <span className="text-2xl shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{item.name}</p>
                        {item.category === 'pro' && (
                          <Badge className="bg-accent/20 border-accent/30 text-accent text-xs border">1.3× premium</Badge>
                        )}
                      </div>
                      <p className="text-xs text-fg-muted mt-0.5">{item.description}</p>
                      {/* Conversion preview — shown on hover */}
                      {hoveredItem === item.id && item.conversionPreview && (
                        <p className="text-xs text-accent/80 mt-1 italic">{item.conversionPreview}</p>
                      )}
                      {item.unavailableReason && (
                        <p className="text-xs text-danger mt-0.5">{item.unavailableReason}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-fg-muted mb-1">{item.pointsCost.toLocaleString()} pts</p>
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={!item.isAvailable || wallet.balance < item.pointsCost}
                        loading={redeeming === item.id}
                        onClick={() => handleRedeem(item)}
                      >
                        Redeem
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-fg-faint mt-3">
                1,000 pts = $10 gift card (Tremendous) or $13 Mushi Pro credit (1.3× premium).
                Gift cards capped at ${wallet.kycCapUsd ?? 599}/yr before KYC required.
                {wallet.nextRedemptionEtaHours !== null && ` Gift card delivery: ~${wallet.nextRedemptionEtaHours}h based on recent orders.`}
              </p>
            </div>

            {/* Recent ledger */}
            {wallet.recentLedger.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3">Recent activity</h2>
                <Card>
                  <div className="divide-y divide-white/5">
                    {wallet.recentLedger.map(entry => (
                      <div key={entry.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-xs font-medium">
                            {LEDGER_REASON_LABEL[entry.reason] ?? entry.reason}
                          </p>
                          <p className="text-xs text-fg-faint mt-0.5">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <p className={`text-sm font-bold ${entry.type === 'credit' ? 'text-ok' : 'text-danger'}`}>
                          {entry.type === 'credit' ? '+' : '-'}{entry.points.toLocaleString()} pts
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {wallet.recentLedger.length === 0 && wallet.balance === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
                <p className="text-2xl mb-2">🪙</p>
                <p className="text-sm font-medium">No points yet</p>
                <p className="text-xs text-fg-muted mt-1">
                  Join an app and submit a bug to earn your first points.
                </p>
                <a href="/tester/apps" className="mt-3 inline-block text-xs text-accent hover:underline">
                  Browse apps →
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </TesterLayout>
  )
}
