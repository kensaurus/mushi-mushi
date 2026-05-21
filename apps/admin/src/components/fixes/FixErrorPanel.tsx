/**
 * FILE: apps/admin/src/components/fixes/FixErrorPanel.tsx
 * PURPOSE: Replaces the "blazing" red monospace error box in FixCard with a
 *          human-friendly panel: plain-English title + hint, one-click action
 *          button, and a collapsible raw-error disclosure for power users.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { humanizeFixError } from '../../lib/humanizeFixError';
import type { HumanizedFixError } from '../../lib/humanizeFixError';

interface Props {
  error: string | null | undefined;
  agent?: string | null;
  category?: string | null;
  onRetry?: () => void;
}

export function FixErrorPanel({ error, agent, category, onRetry }: Props) {
  const [rawOpen, setRawOpen] = useState(false);
  const navigate = useNavigate();

  if (!error) return null;

  const h: HumanizedFixError | null = humanizeFixError(error, { agent, category });

  if (!h) return null;

  const isSoft = h.severity === 'soft';

  function handleAction() {
    if (!h?.action) return;
    const { target } = h.action;
    if (target.kind === 'retry') {
      onRetry?.();
    } else if (target.kind === 'route') {
      const url = target.hash ? `${target.to}#${target.hash}` : target.to;
      navigate(url);
    } else if (target.kind === 'external') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div
      className={`rounded-md border px-3 py-2.5 space-y-1.5 text-xs ${
        isSoft
          ? 'border-warn/30 bg-warn-muted/20 text-fg-secondary'
          : 'border-danger/30 bg-danger-muted/20 text-fg-secondary'
      }`}
    >
      {/* Icon + title row */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-px shrink-0 text-sm leading-none ${
            isSoft ? 'text-warn' : 'text-danger'
          }`}
          aria-hidden
        >
          {isSoft ? '⚠' : '✕'}
        </span>
        <p className={`font-medium ${isSoft ? 'text-warn' : 'text-danger'}`}>{h.title}</p>
      </div>

      {/* Hint */}
      <p className="text-fg-muted pl-5">{h.hint}</p>

      {/* Action + raw toggle row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        {h.action && (
          <button
            type="button"
            onClick={handleAction}
            className={`text-xs underline underline-offset-2 font-medium ${
              isSoft
                ? 'text-warn hover:text-warn/80'
                : 'text-danger hover:text-danger/80'
            }`}
          >
            {h.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => setRawOpen((o) => !o)}
          className="text-xs text-fg-faint underline underline-offset-2 hover:text-fg-muted"
        >
          {rawOpen ? 'Hide technical error' : 'Show technical error'}
        </button>
      </div>

      {/* Raw error disclosure */}
      {rawOpen && (
        <pre className="pl-5 text-2xs font-mono text-fg-faint whitespace-pre-wrap break-all">
          {h.raw}
        </pre>
      )}
    </div>
  );
}
