# Data residency

Source: https://kensaur.us/mushi-mushi/docs/security/data-residency

---
title: Data residency
description: Where Mushi Mushi Cloud stores data today (Tokyo, ap-northeast-1), how the region picked at project creation works, and what the SDK does about regions.
---

# Data residency

> **Scenario:** Your EU customers' data must stay in the EU. You need to know where report ingestion, embeddings, screenshots, and AI calls actually go today.

Mushi Mushi Cloud is designed for one Supabase project per region with no replication between them. Today all production traffic runs on a single Supabase project in `ap-northeast-1` (Tokyo, `dxptnwrhwsqckaftyymj`), whatever region a project picked. The US and EU clusters are planned, not live. Model calls go to the US-based providers listed in the [Privacy Policy](/legal/privacy#5-sub-processors), unless you self-host and choose otherwise.

## Regions

| Region picked at creation | Where the data lives today | Planned dedicated cluster |
| --- | --- | --- |
| **US** (default) | Tokyo (`ap-northeast-1`), the single hosted project | `us-east-1` |
| **EU** | Tokyo, same project | `eu-central-1` |
| **JP** | Tokyo, same project | `ap-northeast-1` |

  Pick the region at project creation. Moving a project that already has data to another region needs an export and restore, so create a new project in the region you want instead.

## How the SDK routes

The browser SDK has no `region` option. It sends everything to `apiEndpoint`,
which defaults to `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`,
and every region resolves to that endpoint today. API keys use one `mushi_…`
format in every region.

`@mushi-mushi/core` also exports `resolveRegionEndpoint`, which asks the
gateway which endpoint serves a project and caches the answer in
`localStorage` for 24 hours. Until regional clusters ship it returns the same
endpoint.

```ts
import { resolveRegionEndpoint } from '@mushi-mushi/core'

const endpoint = await resolveRegionEndpoint({
  projectId: 'YOUR_PROJECT_ID',
  apiEndpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
})
```

## Attestation

There is no cross-region attestation yet. With one hosted project there is nothing to compare against; the region you pick is recorded in `projects.data_residency_region` and mirrored to `region_routing`, which the gateway will use to redirect calls once a second cluster exists. The **Compliance → Residency** tab shows each project's region.

## Self-hosting

If you self-host on your own Supabase project, you control the region entirely — pick any Supabase-supported region at project creation.

## GDPR notes

- Data is encrypted at rest by Supabase's disk encryption. Report columns are not encrypted separately.
- DSARs (data subject access requests) are tracked in the `data_subject_requests` table via `POST /v1/admin/compliance/dsars`; see [SOC 2 readiness](/security/soc2#dsar-data-subject-access-request).
- Transfers from the EEA and UK to Japan rely on the EU's adequacy decision for Japan; transfers to US model providers are covered in the [Privacy Policy](/legal/privacy).
