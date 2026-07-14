/**
 * Audit log resource_type → page links and chip styling.
 */

import { CHIP_TONE } from './chipTone'

export interface AuditResourceInfo {
  label: string
  description: string
  className: string
  listPath: string
}

const RESOURCES: Record<string, AuditResourceInfo> = {
  report: {
    label: 'Bug report',
    description: 'User-submitted bug or feedback. Open Reports to triage or dispatch a fix.',
    className: `${CHIP_TONE.infoSubtle} hover:bg-info-muted/55`,
    listPath: '/reports',
  },
  fix: {
    label: 'Auto-fix',
    description: 'Draft pull request from the fix worker. Review on the Fixes page.',
    className: 'border-accent/30 bg-accent-muted/55 text-accent-foreground hover:bg-accent-muted/55',
    listPath: '/fixes',
  },
  settings: {
    label: 'Settings',
    description: 'Project or org configuration change.',
    className: 'border-edge bg-surface-overlay text-fg-muted hover:bg-surface-overlay/80',
    listPath: '/settings',
  },
  integration: {
    label: 'Integration',
    description: 'GitHub, Sentry, Slack, or another connector.',
    className: 'border-brand/25 bg-brand/12 text-brand border border-brand/28 hover:bg-brand/15',
    listPath: '/integrations',
  },
  project: {
    label: 'Project',
    description: 'App project created or removed.',
    className: 'border-edge bg-surface-overlay text-fg-secondary hover:bg-surface-overlay/80',
    listPath: '/projects',
  },
  plugin: {
    label: 'Plugin',
    description: 'Marketplace plugin install or uninstall.',
    className: `${CHIP_TONE.warnSubtle} hover:bg-warn-muted/50`,
    listPath: '/marketplace',
  },
  compliance: {
    label: 'Compliance',
    description: 'Privacy, retention, or DSAR-related action.',
    className: `${CHIP_TONE.okSubtle} hover:bg-ok-muted/50`,
    listPath: '/compliance',
  },
  api_key: {
    label: 'API key',
    description: 'Minted or revoked project API key.',
    className: 'border-edge-subtle bg-surface-overlay/60 text-fg-muted hover:bg-surface-overlay',
    listPath: '/projects',
  },
}

const DEFAULT_RESOURCE: AuditResourceInfo = {
  label: 'Resource',
  description: 'Consequential platform action. Expand the row for metadata.',
  className: 'border-edge-subtle bg-surface-overlay/60 text-fg-muted hover:bg-surface-overlay',
  listPath: '/audit',
}

export function resolveAuditResource(resourceType: string): AuditResourceInfo {
  return RESOURCES[resourceType] ?? {
    ...DEFAULT_RESOURCE,
    label: resourceType.replace(/_/g, ' '),
  }
}

export function auditResourcePath(resourceType: string, resourceId: string | null): string {
  const info = resolveAuditResource(resourceType)
  if (!resourceId) return info.listPath
  if (resourceType === 'report') return `/reports/${resourceId}`
  if (resourceType === 'fix') return `/fixes?highlight=${resourceId}`
  return info.listPath
}
