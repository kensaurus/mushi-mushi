# Report ingest data contract (SDK → server)

**Last verified:** 2026-06-18 (RN report-pipeline parity uplift, `@mushi-mushi/react-native` 0.17.x).

This document describes the wire format from mobile/web SDKs through
`POST /v1/reports` → `ingestReport()` in `packages/server/supabase/functions/api/helpers.ts`.
Use it when debugging "anonymous reporter" bugs, empty repro timelines, or missing
screenshots in the admin console.

---

## Reporter identity

The host app must call `identify()` / `setUser()` on auth changes. Two wire shapes
are accepted; **both** must resolve to the same `end_users` row:

| Shape | Example | SDK versions |
| ----- | ------- | ------------ |
| **Nested (canonical)** | `metadata.user = { id, email, name, provider }` | Web SDK, RN ≥ 0.17 |
| **Flat (legacy)** | `metadata.userId`, `userEmail`, `userName`, `userProvider` | RN ≤ 0.16 |

Server normalization lives in `resolveReporterIdentity()`:

```typescript
// packages/server/supabase/functions/api/helpers.ts
export function resolveReporterIdentity(metadata, sentryUser?) {
  const nested = metadata?.user
  return {
    id: nested?.id ?? metadata.userId ?? sentryUser?.id,
    email: nested?.email ?? metadata.userEmail ?? sentryUser?.email,
    name: nested?.name ?? metadata.userName ?? sentryUser?.name,
    provider: nested?.provider ?? metadata.userProvider,
  }
}
```

Zod documentation schema: `reporterIdentitySchema` in
`packages/server/supabase/functions/_shared/schemas.ts`.

**Symptom:** Console shows a token hash instead of `kensaurus@gmail.com` display name.
**Fix:** Ensure nested `metadata.user.id` is the Supabase user UUID and `name` is set
(display name or email local-part). yen-yen: `setMushiUser()` in `apps/mobile/lib/mushi.ts`.

---

## Payload fields (RN ≥ 0.17)

| Field | Required | Stored / used |
| ----- | -------- | ------------- |
| `description` | Yes (≥ 20 chars) | `reports.description` |
| `category` | Yes | `reports.category` |
| `reporterToken` | Yes | Hashed → persistent anonymous identity |
| `sessionId` | No | Groups reports from one app launch |
| `sdkPackage` / `sdkVersion` | No | Console SDK freshness chips |
| `appVersion` | No | Environment block |
| `fingerprintHash` | No | Anti-gaming (`rnfp_*` on React Native) |
| `breadcrumbs` | No | Raw ring buffer (max 50 SDK-side) |
| `timeline` | No | **Repro timeline** card in admin |
| `screenshotDataUrl` | No | Uploaded to storage when present |
| `metadata.user` | No | `reports.reporter_user_id` via `resolveEndUser()` |
| `consoleLogs` / `networkLogs` | No | Evidence tabs |

Full schema: `reportSubmissionSchema` in `_shared/schemas.ts`.

---

## Admin console empty states

Platform-aware copy avoids blaming "old SDK" when the host simply disabled capture:

| Helper | File | When |
| ------ | ---- | ---- |
| `screenshotEmptyText(report)` | `apps/admin/src/components/report-detail/reportCaptureHints.ts` | No screenshot attached |
| `timelineEmpty(report)` | same | Empty repro timeline |

Native SDK reports mention `react-native-view-shot` as an optional peer. Host apps
may install the peer but set `capture.screenshot: false` (yen-yen SEC-06 finance policy).

---

## Host app reference (yen-yen)

| Concern | Location |
| ------- | -------- |
| Bridge module | `yen-yen/apps/mobile/lib/mushi.ts` |
| Auth identity | `setMushiUser(..., { provider: 'supabase' })` in `_layout.tsx` |
| Route breadcrumbs | `setMushiScreen({ name, route })` in `_layout.tsx` |
| End-user progress UI | `apps/mobile/app/feedback.tsx` |
| Dev dist patch | `yen-yen/scripts/patch-mushi.mjs` (Stages 1–3) |
| Manual QA checklist | `yen-yen/docs/mushi-integration.md` |

---

## Verification checklist (console)

After submitting from a signed-in dev build:

1. **User** section — display name, not anonymous hash
2. **Metadata** — `metadata.user.provider === "supabase"`
3. **Repro timeline** — at least one `route` entry from navigation
4. **SDK stamp** — `sdkPackage: "@mushi-mushi/react-native"`, version matches build
5. **Screenshot** — empty state text matches policy (may be intentionally off)

---

## Related docs

- [`packages/react-native/README.md`](../packages/react-native/README.md) — SDK install + capture options
- [`apps/docs/content/sdks/react-native.mdx`](../apps/docs/content/sdks/react-native.mdx) — public docs site
- [`yen-yen/docs/mushi-integration.md`](../../yen-yen/docs/mushi-integration.md) — host-app runbook (sibling repo)
