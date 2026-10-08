/**
 * FILE: apps/admin/src/lib/repoRoles.ts
 * PURPOSE: One label, icon and chip tone per `project_repos.role`, so a
 *          project's frontend / backend / mobile repos read the same on the
 *          Repo page and on Connect.
 */

import type { ComponentType } from 'react'
import {
  IconGit,
  IconGlobe,
  IconIntelligence,
  IconMobile,
  IconNetwork,
  IconNote,
  IconProjects,
  IconStorage,
} from '../components/icons'
import type { CHIP_TONE } from './chipTone'

/** The roles the project_repos CHECK and the API accept (repo-branch-counts.ts). */
export const REPO_ROLES = ['frontend', 'backend', 'monorepo', 'mobile', 'ai', 'infra', 'docs', 'other'] as const
export type RepoRole = (typeof REPO_ROLES)[number]

export interface RepoRoleMeta {
  label: string
  /** Decorative: the icons are aria-hidden; the label carries the meaning. */
  Icon: ComponentType<{ className?: string; size?: number }>
  tone: keyof typeof CHIP_TONE
}

const REPO_ROLE_META: Record<RepoRole, RepoRoleMeta> = {
  frontend: { label: 'Frontend', Icon: IconGlobe, tone: 'brandSubtle' },
  backend: { label: 'Backend', Icon: IconNetwork, tone: 'okSubtle' },
  monorepo: { label: 'Monorepo', Icon: IconProjects, tone: 'infoSubtle' },
  mobile: { label: 'Mobile', Icon: IconMobile, tone: 'accentSubtle' },
  ai: { label: 'AI', Icon: IconIntelligence, tone: 'accentSubtle' },
  infra: { label: 'Infra', Icon: IconStorage, tone: 'neutral' },
  docs: { label: 'Docs', Icon: IconNote, tone: 'neutral' },
  other: { label: 'Other', Icon: IconGit, tone: 'neutral' },
}

/** Unknown roles (an older or newer server) render as "other" rather than blank. */
export function repoRoleMeta(role: string | null | undefined): RepoRoleMeta {
  return REPO_ROLE_META[(role ?? 'other') as RepoRole] ?? REPO_ROLE_META.other
}
