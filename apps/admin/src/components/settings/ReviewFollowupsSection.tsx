/**
 * FILE: apps/admin/src/components/settings/ReviewFollowupsSection.tsx
 * PURPOSE: Settings → AI keys → Cursor: "Review follow-ups" (ADR 0032). When
 *          the Opus review of an agent's pull request says "fix first", Mushi
 *          sends the PR back to a new Cursor agent once, with the review's
 *          findings, and Opus reviews the push. This block shows what the
 *          follow-ups produced in the last 7 days and lets an organization
 *          owner or admin turn them on or off and pick the Cursor key, the
 *          model (from that key's Cursor model list) and the daily limit.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/supabase';
import { usePageData } from '../../lib/usePageData';
import { describeByokError } from '../../lib/byokErrors';
import { Btn, Checkbox, Input, ResultChip, SelectField } from '../ui';
import { CursorModelPicker } from './CursorModelPicker';
import {
  followupKeyLabel,
  followupRecentLine,
  followupScoreLine,
  type ReviewFollowupSettings,
  type ReviewFollowupsResponse,
} from './reviewFollowups';

interface Draft {
  enabled: boolean;
  keyId: string;
  model: string;
  escalationModel: string;
  dailyLimit: string;
}

function draftFrom(s: ReviewFollowupSettings): Draft {
  return {
    enabled: s.enabled,
    keyId: s.keyId ?? '',
    model: s.model ?? '',
    escalationModel: s.escalationModel ?? '',
    dailyLimit: String(s.dailyLimit),
  };
}

export function ReviewFollowupsSection() {
  const status = usePageData<ReviewFollowupsResponse | null>('/v1/admin/byok/review-followups');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  // /pipeline links straight here (#review-followups) when follow-ups being off holds PRs.
  const loaded = !!status.data?.settings;
  useEffect(() => {
    if (!loaded || typeof window === 'undefined' || window.location.hash !== '#review-followups') return;
    document.getElementById('review-followups')?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  const data = status.data;
  if (status.loading || !data || !data.available || !data.settings) return null;
  const settings = data.settings;
  const keys = data.keys ?? [];
  const score = followupScoreLine(data.scoreboard);
  const recent = (data.recent ?? []).slice(0, 5);
  const chosen = keys.find((k) => k.id === settings.keyId);

  async function save() {
    if (!draft) return;
    setSaving(true);
    const res = await apiFetch('/v1/admin/byok/review-followups', {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: draft.enabled,
        keyId: draft.keyId || null,
        model: draft.model.trim() || null,
        escalationModel: draft.escalationModel.trim() || null,
        dailyLimit: Number(draft.dailyLimit),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setDraft(null);
      setNotice({ ok: true, message: draft.enabled ? 'Review follow-ups saved and on.' : 'Review follow-ups saved and off.' });
      status.reload();
    } else {
      setNotice({ ok: false, message: describeByokError(res.error, 'Review follow-ups were not saved. Retry in a moment.').message });
    }
  }

  return (
    <section id="review-followups" aria-label="Review follow-ups" className="space-y-2 scroll-mt-20 border-t border-edge-subtle pt-3">
      <h4 className="text-sm font-medium text-fg">Review follow-ups</h4>
      <p className="text-xs text-fg-muted">
        When Opus says an agent&apos;s pull request needs fixes first, Mushi sends it back to a new Cursor agent once,
        with exactly those findings, and Opus reviews the push. Only pull requests a Mushi cloud agent opened, at most
        two per pull request, never on a hold, inside each app&apos;s auto-fix limits. Off until you turn it on; turning
        it on also picks up the last 3 days of fix-first pull requests.
      </p>
      <p className="text-xs text-fg-secondary">
        {settings.enabled
          ? `On: up to ${settings.dailyLimit} a day, on ${chosen ? followupKeyLabel(chosen) : "the key each app's fixes use"}${settings.model ? `, model ${settings.model}` : ''}${settings.escalationModel ? `, last round on ${settings.escalationModel}` : ''}.`
          : 'Off.'}
      </p>
      {!settings.enabled && settings.offReason && <p className="text-xs text-warn">{settings.offReason}</p>}
      {score && <p className="text-xs tabular-nums text-fg-secondary">{score}</p>}
      {recent.length > 0 && (
        <ul className="space-y-0.5" aria-label="Latest follow-ups">
          {recent.map((r) => (
            <li key={r.id} className="text-xs text-fg-muted">
              {followupRecentLine(r)}
            </li>
          ))}
        </ul>
      )}
      {!data.canManage && !draft && (
        <p className="text-xs text-fg-muted">An organization owner or admin can change review follow-ups.</p>
      )}
      {data.canManage && !draft && (
        <Btn
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            setDraft(draftFrom(settings));
            setNotice(null);
          }}
        >
          Change review follow-ups
        </Btn>
      )}
      {draft && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Cursor key"
              helpId="byok.review_followups"
              value={draft.keyId}
              onChange={(e) => setDraft({ ...draft, keyId: e.target.value, model: '', escalationModel: '' })}
            >
              <option value="">The key each app&apos;s fixes use</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {followupKeyLabel(k)}
                </option>
              ))}
            </SelectField>
            <CursorModelPicker
              value={draft.model}
              onChange={(model) => setDraft({ ...draft, model })}
              keyId={draft.keyId || undefined}
              label="Model"
              emptyLabel="Each app's Cursor model"
              tooltip="Checked against this key's Cursor model list before every follow-up."
            />
            <CursorModelPicker
              value={draft.escalationModel}
              onChange={(escalationModel) => setDraft({ ...draft, escalationModel })}
              keyId={draft.keyId || undefined}
              label="Last round model"
              emptyLabel="Same as Model"
              tooltip="A pull request gets at most two follow-ups. The second runs only after the first did not satisfy the reviewer, so a stronger model (for example Opus) can take it while the first stays on the cheaper one."
            />
            <Input
              label="Follow-ups per day"
              type="number"
              min={1}
              max={200}
              value={draft.dailyLimit}
              onChange={(e) => setDraft({ ...draft, dailyLimit: e.target.value })}
              tooltip="Across every app in the organization. Each app's auto-fix limits apply too."
            />
          </div>
          <Checkbox
            label="Send fix-first pull requests back to an agent"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="submit" size="sm" loading={saving}>
              Save
            </Btn>
            <Btn type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Btn>
          </div>
        </form>
      )}
      {notice && <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>}
    </section>
  );
}
