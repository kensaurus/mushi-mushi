/**
 * Visible role-permission guide — answers "what's the difference between roles?"
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { IconShield, IconUser } from '../icons'
import { ORG_ROLE_DEFINITIONS } from '../../lib/orgRoleGuide'

const ROLE_ICON: Record<string, typeof IconUser> = {
  owner: IconShield,
  admin: IconShield,
  member: IconUser,
  viewer: IconUser,
}

export function OrgRoleGuideCard() {
  return (
    <FeatureExplainPanel
      title="What each role can do"
      summary="Roles control invites, billing, triage, and fix dispatch. Assign the smallest role that still lets someone do their job."
      category="roles"
      variant="inset"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-2xs">
          <thead>
            <tr className="border-b border-edge-subtle text-fg-faint uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Role</th>
              <th className="pb-2 pr-3 font-medium">Good for</th>
              <th className="pb-2 pr-3 font-medium">Can do</th>
              <th className="pb-2 font-medium">Cannot do</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {ORG_ROLE_DEFINITIONS.map((role) => {
              const RoleIcon = ROLE_ICON[role.id] ?? IconUser
              return (
                <tr key={role.id}>
                  <td className="py-2 pr-3 align-top font-semibold text-fg whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <RoleIcon size={12} className="text-fg-muted shrink-0" aria-hidden />
                      {role.label}
                    </span>
                  </td>
                  <td className="py-2 pr-3 align-top text-fg-muted max-w-36">{role.tagline}</td>
                  <td className="py-2 pr-3 align-top text-fg-secondary">
                    <ul className="list-disc pl-3 space-y-0.5">
                      {role.canDo.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-2 align-top text-fg-faint">
                    <ul className="list-disc pl-3 space-y-0.5">
                      {role.cannotDo.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </FeatureExplainPanel>
  )
}
