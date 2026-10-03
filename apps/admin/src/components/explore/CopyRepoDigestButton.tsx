/**
 * "Copy digest" — copies the connected repo (or the files one bug touches)
 * as a single paste for an AI chat or coding agent. Plan 020 §10.3.1.
 * Works without codebase indexing: the server reads GitHub at one commit.
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import {
  copyTextFrom,
  DEFAULT_DIGEST_BUDGET,
  DIGEST_BUDGET_OPTIONS,
  digestCopiedSummary,
  digestPath,
  type RepoDigestResponse,
} from '../../lib/repoUnderstanding'
import { Btn, FILTER_SELECT_CLASS } from '../ui'

interface Props {
  projectId: string
  /** Scope to one bug: its files go first. */
  reportId?: string
  /** Show the size picker next to the button. */
  showBudgetPicker?: boolean
  label?: string
  size?: 'sm' | 'md'
}

export function CopyRepoDigestButton({
  projectId,
  reportId,
  showBudgetPicker = true,
  label = 'Copy digest',
  size = 'sm',
}: Props) {
  const toast = useToast()
  const [budget, setBudget] = useState<number>(DEFAULT_DIGEST_BUDGET)
  const [busy, setBusy] = useState(false)

  const copy = async () => {
    setBusy(true)
    // Filled inside the clipboard callback; a holder keeps TS from narrowing it to null.
    const built: { digest: RepoDigestResponse | null } = { digest: null }
    try {
      await copyTextFrom(async () => {
        const res = await apiFetch<RepoDigestResponse>(digestPath(projectId, { budgetTokens: budget, reportId }), {
          cache: 'no-store',
        })
        if (!res.ok || !res.data) {
          throw new Error(res.error?.message ?? 'Could not build the digest')
        }
        built.digest = res.data
        return res.data.text
      })
      if (built.digest) toast.success('Digest copied — paste it into your AI chat', digestCopiedSummary(built.digest))
    } catch (err) {
      toast.error('Could not copy the digest', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="copy-repo-digest">
      {showBudgetPicker && (
        <label className="inline-flex">
          <span className="sr-only">Digest size</span>
          <select
            aria-label="Digest size"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className={FILTER_SELECT_CLASS}
            disabled={busy}
          >
            {DIGEST_BUDGET_OPTIONS.map((o) => (
              <option key={o.tokens} value={o.tokens}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Btn
        size={size}
        variant="ghost"
        onClick={() => void copy()}
        loading={busy}
        title={
          reportId
            ? 'Copy the code around this bug (its files first) as one paste for an AI chat'
            : 'Copy the repo (tree + key files) as one paste for an AI chat'
        }
      >
        {label}
      </Btn>
    </span>
  )
}
