/**
 * Plain-language org role permissions + seat/billing FAQ for Members page.
 */

export type OrgRoleId = 'owner' | 'admin' | 'member' | 'viewer'

export interface OrgRoleDefinition {
  id: OrgRoleId
  label: string
  /** One line for dropdowns and chips */
  tagline: string
  canDo: string[]
  cannotDo: string[]
}

export const ORG_ROLE_DEFINITIONS: OrgRoleDefinition[] = [
  {
    id: 'owner',
    label: 'Owner',
    tagline: 'Full control including billing and deleting the team',
    canDo: [
      'Everything an Admin can do',
      'Change the team plan and payment method on Billing',
      'Transfer or delete the organization',
    ],
    cannotDo: ['Cannot remove the last owner without promoting someone else first'],
  },
  {
    id: 'admin',
    label: 'Admin',
    tagline: 'Manage teammates and all projects — no billing changes',
    canDo: [
      'Invite, remove, and change roles for teammates',
      'Create and configure projects, API keys, and integrations',
      'Triage bugs, dispatch fixes, and merge PRs',
    ],
    cannotDo: [
      'Change subscription or payment details',
      'Delete the organization',
    ],
  },
  {
    id: 'member',
    label: 'Member',
    tagline: 'Day-to-day bug triage and fix work on shared projects',
    canDo: [
      'View and triage reports, run fixes, and review QA stories',
      'Edit project settings for projects they can access',
    ],
    cannotDo: [
      'Invite or remove teammates',
      'Change org-wide billing or SSO',
    ],
  },
  {
    id: 'viewer',
    label: 'Viewer',
    tagline: 'Read-only — good for stakeholders who need visibility',
    canDo: [
      'View reports, dashboards, fix status, and analytics',
      'Browse project settings without saving changes',
    ],
    cannotDo: [
      'Triage, dispatch fixes, edit settings, or invite anyone',
    ],
  },
]

export function orgRoleDefinition(role: OrgRoleId): OrgRoleDefinition {
  return ORG_ROLE_DEFINITIONS.find((r) => r.id === role) ?? ORG_ROLE_DEFINITIONS[2]
}

export interface SeatBillingContext {
  planDisplayName: string | null
  planId: string | null
  seatLimit: number | null
  seatsUsed: number
  teamsEnabled: boolean
}

/** Answers "will adding an admin cost me money?" in plain language. */
export function seatBillingExplainer(ctx: SeatBillingContext): {
  headline: string
  body: string
  billingLink: boolean
  tone: 'neutral' | 'info' | 'warn'
  calloutLabel?: string
} {
  const plan = ctx.planDisplayName ?? ctx.planId ?? 'your plan'

  if (!ctx.teamsEnabled) {
    return {
      headline: 'Teammates require a Teams plan',
      body: `${plan} is solo-only. Upgrading to Pro or Enterprise unlocks invites — you pay one flat monthly price for the plan, not per person.`,
      billingLink: true,
      tone: 'info',
      calloutLabel: 'Upgrade for teams',
    }
  }

  if (ctx.seatLimit === null) {
    return {
      headline: 'Unlimited teammates on this plan',
      body: `Owners, Admins, Members, and Viewers do not add to your bill on ${plan}. Pick roles for permissions, not price.`,
      billingLink: false,
      tone: 'info',
      calloutLabel: 'Unlimited seats',
    }
  }

  const remaining = Math.max(0, ctx.seatLimit - ctx.seatsUsed)
  const nearCap = ctx.seatsUsed >= ctx.seatLimit - 1
  return {
    headline: `${ctx.seatsUsed} of ${ctx.seatLimit} seats used`,
    body: `Each person counts as one seat (any role). Pending invites also reserve a seat. You're on ${plan} with ${remaining} seat${remaining === 1 ? '' : 's'} left — upgrade on Billing if you need more.`,
    billingLink: nearCap,
    tone: nearCap ? 'warn' : 'neutral',
    calloutLabel: nearCap ? 'Seat limit' : 'Seat usage',
  }
}
