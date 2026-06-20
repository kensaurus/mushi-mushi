# Tester portal design notes

The `/tester/*` routes use a **satellite design language** intentionally separate from the main admin console (`apps/admin/src/components/tester/tester-ui.tsx`, purple chrome).

## Why it diverges

- Audience: external bounty testers, not project operators
- Tone: consumer-facing wallet/rewards UX (Tier B expressive) vs operator triage console (Tier D restrained)
- Auth: separate enrollment gate (`TesterWelcomeEnroll`) and balance strip

## Do not unify without product sign-off

Merging tester tokens into `@theme` oklch semantic tokens would blur the boundary between operator tools and the public tester economy. If unification is requested later:

1. Add `html[data-portal="tester"]` attribute on `TesterLayout` root
2. Scope a small token override block in `index.css` — do not fork components
3. Keep wallet/reward semantics distinct from PDCA posture banners

## Canonical files

| File | Role |
|------|------|
| `apps/admin/src/components/tester/TesterLayout.tsx` | Shell + sidebar |
| `apps/admin/src/components/tester/tester-ui.tsx` | Layout primitives |
| `apps/admin/src/pages/tester/*` | Route pages |
