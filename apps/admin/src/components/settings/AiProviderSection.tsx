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

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { describeByokError } from '../../lib/byokErrors';
import { Btn, InfoHint, ResultChip, SegmentedControl } from '../ui';
import { StatusPill } from '../signal/StatusMark';

export type AiProvider = 'anthropic' | 'openai';

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

/**
 * The line under the switch: one short sentence, with the model names behind
 * the (i). At 390 px the full sentence ran to six lines of model ids
 * (round-2 review 2026-11-18).
 */
function aiProviderLine(provider: AiProvider): { line: string; models: string | null } {
  return provider === 'openai'
    ? {
        line: 'Every AI step runs on your OpenAI keys. No Claude key is used.',
        models: 'Fixes and pull request reviews: GPT-6.1 Sol. Bug triage and fix judging: GPT-6.1 Terra. Chat and summaries: GPT-6 Luna.',
      }
    : { line: 'Your Claude keys first; OpenAI only when Claude has no working key.', models: null };
}

interface Props {
  keysToken: string;
  /** Opens the add-key form for OpenAI; called when OpenAI is chosen with no OpenAI key. */
  onNeedOpenAiKey: () => void;
  /** The saved choice, so the key cards below can say what each key is used for under it. */
  onProvider?: (provider: AiProvider) => void;
}

export function AiProviderSection({ keysToken, onNeedOpenAiKey, onProvider }: Props) {
  const status = usePageData<AiProviderResponse | null>('/v1/admin/byok/ai-provider', { deps: [keysToken] });
  const savedProvider = status.data?.aiProvider;
  useEffect(() => {
    if (savedProvider) onProvider?.(savedProvider);
  }, [savedProvider, onProvider]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const data = status.data;
  // Never vanish: at 1440 the switch was missing while 390 showed it, because
  // a slow or failed read rendered nothing (round-2 review 2026-11-18).
  if (status.loading && !data) {
    return (
      <section id="ai-provider" aria-label="Run AI on" aria-busy="true" className="py-3 scroll-mt-20" data-testid="ai-provider-loading">
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-fg">Run AI on</span> · reading the setting…
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section id="ai-provider" aria-label="Run AI on" className="flex flex-wrap items-center gap-2 py-3 scroll-mt-20" data-testid="ai-provider-error">
        <h4 className="text-sm font-medium text-fg">Run AI on</h4>
        <StatusPill status="failed" label="Could not load" />
        <Btn size="sm" variant="ghost" onClick={() => status.reload()}>
          Retry
        </Btn>
      </section>
    );
  }
  const disabled = saving || !data.canManage;
  const copy = aiProviderLine(data.aiProvider);

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
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span>{copy.line}</span>
        {copy.models ? <InfoHint content={copy.models} /> : null}
      </p>
      {!data.canManage && <p className="text-xs text-fg-muted">An organization owner or admin can change this.</p>}
    </section>
  );
}
