/**
 * Plain-language SSO protocol guide for the admin console.
 */

export type SsoProtocolId = 'saml' | 'oidc'

export interface SsoProtocolDefinition {
  id: SsoProtocolId
  label: string
  acronym: string
  plain: string
  whenToUse: string
  setupSteps: string[]
}

export const SSO_PROTOCOL_DEFINITIONS: SsoProtocolDefinition[] = [
  {
    id: 'saml',
    label: 'SAML 2.0',
    acronym: 'SAML',
    plain:
      'Your team signs in through your company identity provider (Okta, Azure AD, Google Workspace). Mushi trusts a signed assertion from that provider instead of a password.',
    whenToUse: 'Enterprise security reviews, MFA enforced centrally, automatic admin provisioning.',
    setupSteps: [
      'Paste your IdP metadata URL below and save.',
      'Copy the ACS URL and Entity ID Mushi returns into your IdP app.',
      'Map your corporate email domain so only @company.com users can sign in.',
      'Test with a non-admin user before rolling out to the whole team.',
    ],
  },
  {
    id: 'oidc',
    label: 'OpenID Connect',
    acronym: 'OIDC',
    plain:
      'Same single sign-on idea as SAML, but uses OAuth-style client ID + issuer URLs. Saved here for audit; auto-registration requires Supabase enterprise support.',
    whenToUse: 'When your IdP only offers OIDC/OAuth and not SAML metadata.',
    setupSteps: [
      'Record issuer URL, client ID, and client secret for your audit trail.',
      'Contact Mushi support to register OIDC with GoTrue on enterprise tier.',
    ],
  },
]

export const SSO_EXPLAINER_SUMMARY =
  'Single Sign-On lets your team log in with your corporate identity provider instead of email and password. SAML 2.0 is fully self-service today; OIDC is recorded for audit and needs support to go live.'

export type SsoTopPriority =
  | 'no_project'
  | 'upgrade_required'
  | 'registration_failed'
  | 'pending_setup'
  | 'no_providers'
  | 'healthy'

export function isSsoGuideExpanded(topPriority: SsoTopPriority | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'upgrade_required' ||
    topPriority === 'registration_failed' ||
    topPriority === 'pending_setup' ||
    topPriority === 'no_providers'
  )
}

export function ssoProtocolDefinition(id: string): SsoProtocolDefinition | undefined {
  return SSO_PROTOCOL_DEFINITIONS.find((p) => p.id === id)
}
