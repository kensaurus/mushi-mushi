# 0021. Host-backend erasure deletes the subject's reports

Status: Proposed Date: 2026-10-06

Related: migration `20260922000015_end_user_erasure.sql` (`DELETE /v1/sdk/me`),
`20261006120000_erase_subject.sql`, `api/routes/erase-subject.ts`.

## Context

Host apps that let people delete their account (Google Play User Data policy,
App Store 5.1.1(v), GDPR Art. 17) must delete what Mushi holds about that
person. The only erasure route was `DELETE /v1/sdk/me`, the end user's own
self-service route. It erases the org-level `end_users` row, sessions and
analytics, but **unlinks** reports (`reports.end_user_id ON DELETE SET NULL`):
the description, screenshot, console and network logs and device data stay.
It also needs the public SDK key plus a user token, and it erases across the
whole organization, which can hold several apps.

yen-yen (kenji) recorded every Mushi erasure as a manual follow-up for the
owner because no server-side route existed.

## Decision

Add `POST /v1/sdk/erase-subject` for a host app's **backend**:

- **Auth:** an erase token in `X-Mushi-Erase-Token`, HS256-signed with the
  project's identity secret (the one that already signs `X-Mushi-User-Token`),
  with `purpose: "erase-subject"` and `exp - iat <= 300`. No new secret and no
  API key. SDK identity tokens live on end users' devices and have no purpose
  claim, so they are refused (403). Same 401 for "no secret" and "bad
  signature"; 30 requests a minute per project.
- **Scope:** one project. The subject's reports are **deleted**, not unlinked:
  by `end_user_id`, by `reporter_user_id = sub`, and by the reporter-token
  digests of the subject's own identified sessions and reports (the same
  device's anonymous reports). Their reporter-side rows in the project go too.
  The org-level identity (`erase_end_user`) is erased only when the token says
  `erase_identity: true`, which the host sends when the person is gone from
  every app in the organization.
- **Order:** screenshots are deleted from storage first, because report rows
  are the only record of the keys. A storage failure returns 502 and touches
  nothing else, so the host retries.
- Unknown subject: 200 with zero counts. Idempotent. The audit row has counts
  only, never the subject id.

## Rejected alternatives

- Make `DELETE /v1/sdk/me` delete reports. The self-service route belongs to
  the end user; a person leaving a rewards program is not deleting their
  account, and the operator keeps the bug report they filed.
- Authenticate with a project API key. The SDK key is public, and a new
  `privacy:write` scope would be one more secret for every host to provision.
  The identity secret is already on the host's server for this purpose.
- Delete rows first and storage later. A storage failure would orphan files
  that nothing references any more.
- Erase the org-level identity on every call. One app's account deletion
  would remove the person's identity, points and sessions from the
  organization's other apps.
