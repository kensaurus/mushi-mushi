/**
 * FILE: apps/admin/src/components/ProjectCreatedSuccessPanel.tsx
 * PURPOSE: Post-create success surface — shows Project ID + auto-minted API key
 *          + a single prefilled `mushi init` command so users are one copy-paste
 *          away from completing SDK setup without navigating anywhere else.
 *
 * OVERVIEW:
 * - Large copyable Project ID chip
 * - API key revealed once (masked by default, toggle to reveal), with a
 *   "shown only once" warning and a copy button
 * - Single prefilled `mushi init --project-id <id> --api-key <key>` command
 * - "Regenerate key" affordance: confirms, then rotates exactly the auto-minted
 *   key (POST /v1/admin/projects/:id/keys/rotate with its keyId)
 * - If automint failed (apiKey null), falls back to the old "Generate API key" CTA
 *
 * USAGE:
 * - OnboardingPage and ProjectsPage after `useCreateProject` succeeds
 */

import { useState } from 'react'
import { Btn, Card, CopyButton } from './ui'
import { CodeInline } from './CodePanel'
import { useToast } from '../lib/toast'
import { buildMushiInitCommand } from '../lib/cliSetupCommands'
import { RotateKeyDialog } from './RotateKeyDialog'

export interface CreatedProjectInfo {
  id: string
  slug: string
  name: string
  /** Raw SDK ingest key returned once at project creation. null if automint failed. */
  apiKey?: string | null
  /** 12-char key prefix for display. */
  keyPrefix?: string | null
  /** Row id of the auto-minted key; Regenerate rotates exactly this key. */
  apiKeyId?: string | null
}

interface Props {
  project: CreatedProjectInfo
  /** When true, adjust copy to say "copy these into your CLI". */
  fromCliSetup?: boolean
  onDismiss?: () => void
}

function ProjectIdCopyLarge({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(projectId)
      setCopied(true)
      toast.success('Project ID copied — paste it into the CLI or .env.local.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Clipboard blocked — select the ID and copy manually.')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-edge bg-surface-overlay/60 px-3 py-2.5 text-left transition-opacity hover:border-edge-strong"
      title="Copy project ID — paste as MUSHI_PROJECT_ID"
      data-testid={`project-created-id-${projectId}`}
      aria-label={`Copy project ID: ${projectId}`}
    >
      <CodeInline className="min-w-0 break-all text-xs">
        <span className="tabular-nums">{projectId}</span>
      </CodeInline>
      <span className="shrink-0 text-2xs text-fg-muted">{copied ? 'Copied ✓' : 'Copy'}</span>
    </button>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
    </svg>
  )
}

function ApiKeyRevealBlock({
  rawKey,
  onRegenerate,
  regenerating,
}: {
  rawKey: string
  /** Omitted when the key's id is unknown: only a named key can be rotated. */
  onRegenerate?: () => void
  regenerating: boolean
}) {
  const [visible, setVisible] = useState(false)

  const displayKey = visible
    ? rawKey
    : rawKey.slice(0, 12) + '•'.repeat(Math.max(0, rawKey.length - 12))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">SDK API Key</p>
        <span className="rounded bg-warn-muted/50 px-1.5 py-0.5 text-2xs font-medium text-warning-foreground">
          Shown once — copy now
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn-muted/30 px-3 py-2.5">
        <CodeInline className="min-w-0 flex-1 break-all text-xs">
          <span className="tabular-nums select-all">{displayKey}</span>
        </CodeInline>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="shrink-0 text-fg-muted hover:text-fg"
          aria-label={visible ? 'Hide key' : 'Reveal key'}
        >
          <EyeIcon open={visible} />
        </button>
        <CopyButton value={rawKey} label="Copy API key" data-testid="copy-api-key" />
      </div>
      <p className="text-2xs text-fg-faint">
        This key has <strong>report:write</strong> scope — use it as{' '}
        <code className="font-mono">MUSHI_API_KEY</code> in your SDK config.{' '}
        {onRegenerate ? (
        <button
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
        >
          <RefreshIcon spinning={regenerating} />
          Regenerate
        </button>
        ) : null}
      </p>
    </div>
  )
}

export function ProjectCreatedSuccessPanel({
  project,
  fromCliSetup = false,
  onDismiss,
}: Props) {
  const toast = useToast()
  const [liveKey, setLiveKey] = useState<string | null>(project.apiKey ?? null)
  const [liveKeyId, setLiveKeyId] = useState<string | null>(project.apiKeyId ?? null)
  const [livePrefix, setLivePrefix] = useState<string | null>(project.keyPrefix ?? null)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const initCmd = buildMushiInitCommand(project.id, liveKey)

  return (
    <Card className="space-y-4 border border-ok/30 bg-ok/5 p-5" data-testid="project-created-success">
      <div>
        <h3 className="text-sm font-semibold text-fg">
          {fromCliSetup ? 'Project created — copy these into your CLI' : `"${project.name}" is ready`}
        </h3>
        <p className="mt-1 text-xs text-fg-muted">
          {liveKey
            ? 'Copy the command below to finish SDK setup.'
            : 'Your Project ID is shown below. Generate an API key next, then run the CLI in your app folder.'}
        </p>
      </div>

      {/* Project ID */}
      <div className="space-y-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Project ID</p>
        <ProjectIdCopyLarge projectId={project.id} />
      </div>

      {/* API Key — shown when automint succeeded */}
      {liveKey ? (
        <ApiKeyRevealBlock
          rawKey={liveKey}
          // Without the key's id there is no way to rotate only this key.
          onRegenerate={liveKeyId ? () => setConfirmRotate(true) : undefined}
          regenerating={confirmRotate}
        />
      ) : null}

      {/* CLI command */}
      <div className="space-y-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">
          {liveKey ? 'Run this in your project folder' : 'CLI (after you generate an API key)'}
        </p>
        <div className="flex items-start gap-2 rounded-md border border-edge-subtle bg-surface px-3 py-2">
          <CodeInline className="min-w-0 flex-1 break-all text-2xs">{initCmd}</CodeInline>
          <CopyButton value={initCmd} label="Copy mushi init command" data-testid="copy-mushi-init-cmd" />
        </div>
        {liveKey ? (
          <p className="text-2xs text-fg-faint">
            Or use <code className="font-mono">npx mushi-mushi</code> to run without installing globally.
          </p>
        ) : null}
      </div>

      {confirmRotate && liveKeyId ? (
        <RotateKeyDialog
          projectId={project.id}
          apiKey={{
            id: liveKeyId,
            key_prefix: livePrefix ?? liveKey?.slice(0, 12) ?? 'mushi_',
            label: 'sdk-ingest',
            scopes: ['report:write'],
          }}
          onCancel={() => setConfirmRotate(false)}
          onError={(message) => {
            setConfirmRotate(false)
            toast.error('Could not regenerate key', message)
          }}
          onRotated={(rotated) => {
            setConfirmRotate(false)
            setLiveKey(rotated.key)
            setLiveKeyId(rotated.id)
            setLivePrefix(rotated.prefix)
            if (rotated.oldKeyStillActive) {
              toast.error('New key created, but the old key is still active', 'Revoke it under Projects → Your projects → Keys.')
            } else {
              toast.success('Key regenerated — copy the new key above.')
            }
          }}
        />
      ) : null}

      {/* CTA row — Btn renders the link itself (no button nested in a link, QA bug 264). */}
      <div className="flex flex-wrap gap-2">
        {!liveKey ? (
          <Btn size="sm" variant="primary" to={`/onboarding?tab=verify&project=${project.id}`}>
            Generate API key
          </Btn>
        ) : null}
        <Btn size="sm" variant={liveKey ? 'primary' : 'ghost'} to={`/connect?project=${project.id}`}>
          {liveKey ? 'Continue to Connect hub' : 'Open Connect & Update'}
        </Btn>
        {onDismiss ? (
          <Btn size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Btn>
        ) : null}
      </div>
    </Card>
  )
}
