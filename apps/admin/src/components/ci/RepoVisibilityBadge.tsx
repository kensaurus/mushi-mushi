/**
 * FILE: apps/admin/src/components/ci/RepoVisibilityBadge.tsx
 * PURPOSE: Public / private next to a repo name on /ci (ADR 0037). It
 *          decides what CI costs: public repos run standard GitHub-hosted
 *          minutes free, private repos pay after the plan's included minutes.
 *          Icon, word and tooltip together, never colour alone.
 */

import { Badge } from '../ui'
import { IconGlobe, IconLock } from '../icons'
import type { RepoVisibility } from '../../lib/ciCompareTypes'

const META: Record<RepoVisibility, { label: string; title: string; tone: 'okSubtle' | 'neutral' }> = {
  public: { label: 'Public', title: 'Public repository: GitHub-hosted minutes are free. A pull request from a fork can run code on a self-hosted runner.', tone: 'okSubtle' },
  private: { label: 'Private', title: 'Private repository: GitHub-hosted minutes are billed after your plan’s included minutes.', tone: 'neutral' },
  unknown: { label: 'Not checked', title: 'Mushi has not read this repository’s visibility yet (it does once a day). Costs assume private.', tone: 'neutral' },
}

export function RepoVisibilityBadge({ visibility }: { visibility: RepoVisibility }) {
  const m = META[visibility]
  return (
    <Badge tone={m.tone} title={m.title}>
      <span className="inline-flex items-center gap-1" data-testid={`repo-visibility-${visibility}`}>
        {visibility === 'public' ? <IconGlobe size={10} /> : visibility === 'private' ? <IconLock size={10} /> : null}
        {m.label}
        <span className="sr-only">. {m.title}</span>
      </span>
    </Badge>
  )
}
