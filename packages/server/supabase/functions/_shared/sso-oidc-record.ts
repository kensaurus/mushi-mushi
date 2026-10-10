/**
 * FILE: _shared/sso-oidc-record.ts
 * PURPOSE: What an OpenID Connect provider row stores (suspected-bugs entry
 *          119: the issuer and client ID were posted but never saved).
 *
 * Supabase registers OIDC providers by hand, so Mushi only keeps a record the
 * admin can quote in a support ticket. The row reuses the two SAML columns
 * with the same role (the unused `oidc_client_id` / `oidc_issuer_url` columns
 * from 20260527110000 are not written):
 *   - `metadata_url` holds the issuer (its `/.well-known/openid-configuration`
 *     is the OIDC metadata document);
 *   - `entity_id` holds the client ID (the relying party's identifier).
 * The client secret is never stored: the console no longer asks for it, and a
 * request that sends one is refused so it cannot land anywhere by mistake.
 *
 * Imported only by api/routes/sso-audit.ts.
 */

export interface OidcBody {
  issuerUrl?: unknown
  clientId?: unknown
  clientSecret?: unknown
}

export type OidcRecord =
  | { ok: true; metadata_url: string; entity_id: string }
  | { ok: false; code: string; message: string }

export function oidcRecordFields(body: OidcBody): OidcRecord {
  if (body.clientSecret !== undefined && body.clientSecret !== null && body.clientSecret !== '') {
    return {
      ok: false,
      code: 'SECRET_NOT_STORED',
      message: "Mushi doesn't store OIDC client secrets. Remove it and give it to Supabase support directly.",
    }
  }
  const issuer = typeof body.issuerUrl === 'string' ? body.issuerUrl.trim() : ''
  let parsed: URL | null = null
  try {
    parsed = issuer ? new URL(issuer) : null
  } catch {
    parsed = null
  }
  if (!parsed || parsed.protocol !== 'https:') {
    return { ok: false, code: 'MISSING_ISSUER', message: 'OpenID Connect needs the issuer URL, starting with https://.' }
  }
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId || clientId.length > 255) {
    return { ok: false, code: 'MISSING_CLIENT_ID', message: 'OpenID Connect needs the client ID from your identity provider.' }
  }
  return { ok: true, metadata_url: issuer.slice(0, 2048), entity_id: clientId }
}
