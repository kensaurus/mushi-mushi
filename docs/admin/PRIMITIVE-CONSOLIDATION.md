# Admin UI primitive consolidation (proposal)

Phase C inventory — **proposal only**. No files deleted in this pass. Tone tokens live in `apps/admin/src/lib/chipTone.ts`; prefer `CHIP_TONE` / `statusChipTone()` over ad-hoc Tailwind pill strings.

## Card

| Canonical | Path | Notes |
|-----------|------|-------|
| **Card** | `apps/admin/src/components/ui/layout.tsx` | Default raised surface; `variant="flat" \| "elevated" \| "default"`. Use `variant="inset"` inside other cards. |
| ContainedBlock | `apps/admin/src/components/report-detail/ReportSurface.tsx` | Report detail sub-panels — keep (domain layout). |

### Feature cards — keep (domain meaning)

- `FixCard`, `QueueItemCard`, `ProjectBillingCard`, `BudgetForecastCard`, `GateFindingCard`, `IntelligenceReportCard`, integration `*IntegrationCard` family, `SdkInstallCard`, etc. — these encode workflow layout, not generic chrome.

### Merge candidates (proposal)

- Repeated “KPI tile” patterns inside dashboards that only wrap `Card variant="elevated"` + a title — could share a thin `MetricCard` helper once a third identical copy appears (currently ~2).
- Settings sub-panels that duplicate `Card` + `SettingsSubsection` padding — align on `Card variant="flat"` only.

---

## Badge / Chip / Pill / Dot

| Canonical | Path | Use when |
|-----------|------|----------|
| **Badge** | `apps/admin/src/components/ui/layout.tsx` | Static label chip; `tone` from `BadgeTone` (= `CHIP_TONE` keys). |
| **SignalChip** | `apps/admin/src/components/report-detail/ReportSurface.tsx` | Inline proof / telemetry meta (`neutral`, `brand`, `ok`, …). |
| **JobStatusPill** | `apps/admin/src/components/ui/job-status-pill.tsx` | Async job / SDK upgrade PR lifecycle (spinner → PR link). |
| **CHIP_TONE** | `apps/admin/src/lib/chipTone.ts` | Raw class strings when no wrapper fits; use `statusChipTone()` for severity. |

### Feature-specific — keep (domain meaning)

| Component | Why keep |
|-----------|----------|
| `PlanBadge` | Billing tier + quota readout; deep-links to `/billing`. |
| `UpgradePill` (`UpgradeNudge.tsx`) | Entitlement gate marker on nav rows; avoids nested `<a>`. |
| `VersionBadge` | Release / changelog affordance in chrome. |
| `PrivacyPostureBadge` | SOC2 / data-residency signal in sidebar. |
| `PipelineStageChip` | PDCA stage letter + color from flow tokens. |
| `OperationChip` | Audit log verb coloring. |
| `ClaudeAgentBadge` / `CursorAgentBadge` | Fix pipeline agent attribution. |
| `ReportSourceBadge` | Reporter SDK vs web vs native origin. |
| `ClarifyChips` | Ask Mushi clarify-option picker (interactive, not a label). |
| `FilterChipRail` / `ActiveFiltersRail` | Removable filter chips with dismiss affordance. |
| `CostDisplayChips` | LLM cost breakdown units ($, tok, model). |
| `IntegrationCredentialChips` | Masked secret fingerprint rows. |
| `NodeChip` | Graph canvas node type marker. |
| `SidebarHealthDot` / `IntegrationHealthDot` | Pulse / staleness indicators (not text chips). |
| `InventoryStatusPill` | Discovery lifecycle state on inventory rows. |
| `ActiveProjectStatusChip` / `AuditResourceChip` | Resource-type chips in audit surfaces. |

### Merge candidates (proposal)

| Sprawl | Target | Rationale |
|--------|--------|-----------|
| Hand-rolled `<span className={CHIP_TONE.*}>` in new code | `Badge` or `SignalChip` | Single import; tone prop prevents drift. |
| `SdkVersionBadge` vs `VersionBadge` | Document boundary or fold semver freshness into `VersionBadge` with `kind="sdk"` prop | Both show version strings in chrome. |
| `OperationChip` vs generic `Badge` | Keep `OperationChip` but implement as `Badge` wrapper internally | Same tones, less duplicated class strings. |
| `PipelineStageChip` vs `Badge` | Keep public API; inner span could use `Badge` + stage token map | Visual parity with PDCA flow. |
| Ad-hoc rounded-full status spans in Connect/Projects | `JobStatusPill` | Already canonical for upgrade PR states. |
| `UpgradePill` vs `Badge tone="brand"` | Keep separate — link vs span semantics differ | Do not merge without resolving `<a>` nesting rules. |

---

## Button / overlay (Phase C cross-ref)

| Canonical | Path |
|-----------|------|
| **Btn** | `apps/admin/src/components/ui/forms.tsx` |
| **Modal** | `apps/admin/src/components/Modal.tsx` |
| **Drawer** | `apps/admin/src/components/Drawer.tsx` |

`StageDrawer` now wraps `Drawer` (`flow-primitives/StageDrawer.tsx`). Inline preflight popovers (`DispatchFixPreflight`, `MergeFixPreflight`), coach marks (`FirstRunTour`), config help popover (`ConfigHelp`), and canvas inspectors (`EdgeInspector`) intentionally stay bespoke — see `mushi-ui: intentional overlay` comments in those files.

---

## Next steps (not in this pass)

1. Codemod pass: replace raw `CHIP_TONE.*` spans with `Badge` where children are plain text.
2. Add `Badge` re-export from `components/ui.tsx` barrel if not already re-exported.
3. ESLint rule: flag new `role="dialog"` outside `Modal` / `Drawer` / documented exceptions.
