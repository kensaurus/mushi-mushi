/**
 * FILE: apps/admin/src/components/settings/SpendDownSection.tsx
 * PURPOSE: Settings → AI keys → Cursor: "Spend down expiring credits"
 *          (ADR 0028). For each Cursor key: what spend-down is doing now, and
 *          a small form for the credit expiry date, the model (picked from
 *          that key's Cursor account), fixes per day and how many days ahead
 *          to start. The spend-down worker does the
 *          dispatching, inside each app's auto-fix caps; fixes open draft PRs.
 */

import { useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { describeByokError } from '../../lib/byokErrors';
import { Btn, Checkbox, Input, ResultChip } from '../ui';
import { CursorModelPicker } from './CursorModelPicker';
import { spendDownLine, spendDownStops, type SpendDownKeyStatus, type SpendDownResponse } from './spendDown';

interface Draft {
  enabled: boolean;
  creditsExpireAt: string;
  model: string;
  dailyLimit: string;
  windowDays: string;
}

function draftFrom(k: SpendDownKeyStatus): Draft {
  return {
    enabled: k.enabled,
    creditsExpireAt: k.creditsExpireAt?.slice(0, 10) ?? '',
    model: k.model ?? '',
    dailyLimit: String(k.dailyLimit),
    windowDays: String(k.windowDays),
  };
}

const TONE: Record<'muted' | 'ok' | 'warn', string> = {
  muted: 'text-fg-muted',
  ok: 'text-fg-secondary',
  warn: 'text-warn',
};

export function SpendDownSection({ canManageShared }: { canManageShared: boolean }) {
  const status = usePageData<SpendDownResponse>('/v1/admin/byok/spend-down');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const keys = status.data?.keys ?? [];
  if (status.loading || keys.length === 0) return null;

  async function save(k: SpendDownKeyStatus) {
    if (!draft) return;
    setSaving(true);
    const res = await apiFetch(`/v1/admin/byok/keys/${k.id}/spend-down`, {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: draft.enabled,
        creditsExpireAt: draft.creditsExpireAt || null,
        model: draft.model.trim() || null,
        dailyLimit: Number(draft.dailyLimit),
        windowDays: Number(draft.windowDays),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(null);
      setNotice({ id: k.id, ok: true, message: draft.enabled ? 'Spend-down saved and on.' : 'Spend-down saved and off.' });
      status.reload();
    } else {
      setNotice({
        id: k.id,
        ok: false,
        message: describeByokError(res.error, 'Spend-down was not saved. Retry in a moment.').message,
      });
    }
  }

  return (
    <section aria-label="Spend down expiring credits" className="space-y-2 border-t border-edge-subtle pt-3">
      <h4 className="text-sm font-medium text-fg">Spend down expiring credits</h4>
      <p className="text-xs text-fg-muted">
        Before a key&apos;s credits expire, Mushi sends open bugs to Cursor on its own, best first, so the credits
        fix something. It only uses the apps this key already pays for, never goes past their auto-fix limits, and
        every fix opens a draft pull request for you to review.
      </p>
      <ul className="divide-y divide-edge-subtle">
        {keys.map((k) => {
          const line = spendDownLine(k);
          const stops = spendDownStops(k);
          const readOnly = k.scope === 'organization' && !canManageShared;
          const open = editing === k.id && draft;
          return (
            <li key={k.id} className="space-y-1.5 py-2">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-mono text-fg-secondary">{k.keyHint ?? '…****'}</span>
                {k.label && <span className="text-fg-muted">{k.label}</span>}
              </p>
              <p className={`text-xs ${TONE[line.tone]}`}>{line.text}</p>
              {stops.map((s) => (
                <p key={s} className="text-xs text-fg-muted">
                  {s}
                </p>
              ))}
              {readOnly && !open && (
                <p className="text-xs text-fg-muted">Shared by your organization. An owner or admin can change it.</p>
              )}
              {!readOnly && !open && (
                <Btn
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setEditing(k.id);
                    setDraft(draftFrom(k));
                    setNotice(null);
                  }}
                >
                  {k.enabled ? 'Change spend-down' : 'Set up spend-down'}
                </Btn>
              )}
              {open && draft && (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(k);
                  }}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      label="Credits expire on"
                      type="date"
                      value={draft.creditsExpireAt}
                      onChange={(e) => setDraft({ ...draft, creditsExpireAt: e.target.value })}
                      tooltip="From the credits card on the Cursor dashboard."
                    />
                    <CursorModelPicker
                      value={draft.model}
                      onChange={(model) => setDraft({ ...draft, model })}
                      keyId={k.id}
                      emptyLabel="Each app's Cursor model"
                      tooltip="Empty uses each app's Cursor model."
                    />
                    <Input
                      label="Fixes per day"
                      type="number"
                      min={1}
                      max={200}
                      value={draft.dailyLimit}
                      onChange={(e) => setDraft({ ...draft, dailyLimit: e.target.value })}
                      tooltip="Across every app this key pays for."
                    />
                    <Input
                      label="Start this many days before expiry"
                      type="number"
                      min={1}
                      max={90}
                      value={draft.windowDays}
                      onChange={(e) => setDraft({ ...draft, windowDays: e.target.value })}
                    />
                  </div>
                  <Checkbox
                    label="Spend down this key's credits"
                    helpId="byok.spend_down"
                    checked={draft.enabled}
                    onChange={(v) => setDraft({ ...draft, enabled: v })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn type="submit" size="sm" loading={saving}>
                      Save
                    </Btn>
                    <Btn type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Btn>
                  </div>
                </form>
              )}
              {notice?.id === k.id && <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
