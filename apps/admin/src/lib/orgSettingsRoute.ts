/**
 * FILE: apps/admin/src/lib/orgSettingsRoute.ts
 * PURPOSE: `/org/:slug/settings/*` used to render whichever team was active
 *          in the header and ignore both the slug and the sub-path, so a
 *          shared link opened the wrong team. This resolves the link to the
 *          canonical members URL for the named team.
 */

type MembersTab = 'roster' | 'invites' | 'setup'

const SUB_PATH_TAB: Record<string, MembersTab> = {
  '': 'roster',
  members: 'roster',
  roster: 'roster',
  invites: 'invites',
  invitations: 'invites',
  setup: 'setup',
  general: 'setup',
  billing: 'setup',
}

export type OrgSettingsLinkResolution =
  | { kind: 'redirect'; to: string; orgId: string }
  | { kind: 'unknown-team'; slug: string }

export function resolveOrgSettingsLink(
  slug: string,
  subPath: string | undefined,
  orgs: ReadonlyArray<{ id: string; slug: string }>,
): OrgSettingsLinkResolution {
  const org = orgs.find((o) => o.slug === slug)
  if (!org) return { kind: 'unknown-team', slug }
  const first = (subPath ?? '').split('/')[0]?.toLowerCase() ?? ''
  const tab = SUB_PATH_TAB[first] ?? 'roster'
  const params = new URLSearchParams({ org: org.id })
  if (tab !== 'roster') params.set('tab', tab)
  return { kind: 'redirect', to: `/organization/members?${params.toString()}`, orgId: org.id }
}
