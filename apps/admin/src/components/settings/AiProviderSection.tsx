/**
 * FILE: apps/admin/src/components/settings/AiProviderSection.tsx
 * PURPOSE: Settings → AI keys → "Run AI on": Claude or OpenAI, for every app in
 *          the organization (ADR 0039 amendment, 2026-10-31). The owner's
 *          Claude credits ran low and the OpenAI key was already stored, but
 *          pausing the Claude key alone still left the platform Claude key in
 *          use. On OpenAI, triage, judging and the pull request review all run
 *          on the organization's OpenAI keys and no Claude key is used.
 *          Choosing OpenAI with no OpenAI key opens the add-key form for
 *          OpenAI (`onNeedOpenAiKey`) instead of refusing: the user wants
 *          OpenAI, so the next step is the key. Re-reads when the OpenAI key
 *          list changes (`keysToken`), so the switch can be made right after.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { describeByokError } from '../../lib/byokErrors';
import { ResultChip, SegmentedControl } from '../ui';

type AiProvider = 'anthropic' | 'openai';

interface AiProviderResponse {
  organizationId: string;
  aiProvider: AiProvider;
  canManage: boolean;
  hasOpenAiKey: boolean;
}

const OPTIONS: Array<{ id: AiProvider; label: string }> = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'OpenAI' },
];

/** The sentence under the switch: what runs where, in the user's words. */
function aiProviderLine(provider: AiProvider): string {
  return provider === 'openai'
    ? 'On OpenAI: bug triage, fix judging and pull request reviews use your OpenAI keys (GPT-6.1 Sol). No Claude key is used.'
    : 'On Claude: Mushi uses your Claude keys first and your OpenAI keys only when Claude has no working key.';
}

interface Props {
  keysToken: string;
  /** Opens the add-key form for OpenAI; called when OpenAI is chosen with no OpenAI key. */
  onNeedOpenAiKey: () => void;
}

export function AiProviderSection({ keysToken, onNeedOpenAiKey }: Props) {
  const status = usePageData<AiProviderResponse | null>('/v1/admin/byok/ai-provider', { deps: [keysToken] });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const data = status.data;
  if (status.loading || !data) return null;
  const disabled = saving || !data.canManage;

  async function choose(next: AiProvider) {
    if (!data || next === data.aiProvider) return;
    if (next === 'openai' && !data.hasOpenAiKey) {
      setNotice({ tone: 'info', message: 'Add an OpenAI key, then choose OpenAI again.' });
      onNeedOpenAiKey();
      return;
    }
    setSaving(true);
    setNotice(null);
    const res = await apiFetch('/v1/admin/byok/ai-provider', {
      method: 'PATCH',
      body: JSON.stringify({ aiProvider: next }),
    });
    setSaving(false);
    if (res.ok) {
      setNotice({ tone: 'success', message: next === 'openai' ? 'Your apps now run AI on OpenAI.' : 'Your apps now run AI on Claude.' });
      status.reload();
    } else {
      setNotice({ tone: 'error', message: describeByokError(res.error, 'The AI provider was not changed. Retry in a moment.').message });
    }
  }

  return (
    <section id="ai-provider" aria-label="Run AI on" className="space-y-1.5 py-3 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium text-fg">Run AI on</h4>
        <SegmentedControl
          ariaLabel="Run AI on"
          size="sm"
          value={data.aiProvider}
          options={OPTIONS}
          onChange={(next) => void choose(next)}
          disabled={disabled}
        />
        {notice && <ResultChip tone={notice.tone}>{notice.message}</ResultChip>}
      </div>
      <p className="text-xs text-fg-muted">{aiProviderLine(data.aiProvider)}</p>
      {!data.canManage && <p className="text-xs text-fg-muted">An organization owner or admin can change this.</p>}
    </section>
  );
}
