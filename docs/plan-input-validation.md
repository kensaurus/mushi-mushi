# Plan — Input validation (Mushi console + API + SDK)

Audit-and-plan output of `/plan-input-validation` (Jul 2026). Implementation
tracked in the burndown plan `mushi-console-error-validation`.

## Verdict (pre-fix)

| Boundary | Finding |
| --- | --- |
| Console validators | `lib/validators.ts` solid but skipped by BYOK, reward-webhook, CreateStoryModal cron, reward-quests |
| Admin POST/PUT | Most routes read `c.req.json()` with only UUID/scope checks — biggest hole |
| Mass assignment | `{...form}` spreads in Experiments, NewRunForm, rewards panels, TesterSettings |
| XSS | LOW — Streamdown / `escapeHtml`; recommended prefix pins |
| Inbound webhooks | Fail closed (good) |
| Outbound reward webhook | Signed as `'unsigned'` when secret missing — **fail-open** |
| SDK | Web min-length 20; RN presence-only; neither capped maxLength; RN `sendAssistant` no catch |

## Shipped remediation

| Item | Change |
| --- | --- |
| Cron validator | `cronExpression()` in `validators.ts` + CreateStoryModal |
| Form wiring | BYOK `token()`, webhook `httpsUrl`+`token()`, quests `numberInRange` |
| Explicit bodies | Experiments, NewRunForm, TesterSettings, reward quests (no `{...form}`) |
| Backend Zod | QA story create + experiment create return `VALIDATION_ERROR` + `fieldErrors` |
| Streamdown | `allowedLinkPrefixes` / `allowedImagePrefixes` on markdown call sites |
| Reward webhooks | Fail closed when secret cannot load (no `'unsigned'`) |
| SDK | RN min 20 + maxLength 4000 both platforms; assistant `catch`; honest failure kinds |

## Remaining (follow-ups)

- Expand Zod body schemas to the rest of mutation-heavy admin POST/PUT routes
  beyond QA stories / experiments (inventory, billing mutations, etc.).
- Route server `fieldErrors` maps onto every form field that still only shows a
  toast (partial coverage today).
- Add a shared OpenAPI / Zod generator once more routes share schemas.

## Verify

- Invalid CreateStoryModal cron → client-side validator error before POST
- Invalid experiment body → `VALIDATION_ERROR` with `fieldErrors`
- Missing reward-webhook secret → delivery skipped / error (not unsigned HMAC)
- RN description under 20 chars cannot submit
