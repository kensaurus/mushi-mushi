/**
 * FILE: apps/admin/src/components/cost/budgetInput.ts
 * PURPOSE: What the budget field means. The monthly budget gates all LLM
 *          spend (_shared/llm-budget.ts), so a typo must never clear it:
 *          only an explicitly empty field clears, and the caller confirms.
 */

export type BudgetInput =
  | { kind: 'set'; value: number }
  | { kind: 'clear' }
  | { kind: 'invalid'; message: string }

export function parseBudgetInput(raw: string): BudgetInput {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'clear' }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { kind: 'invalid', message: 'Enter an amount in dollars, like 50 or 12.50.' }
  }
  const value = Number(trimmed)
  if (!(value > 0)) return { kind: 'invalid', message: 'The budget must be more than $0. Leave it empty to remove the budget.' }
  return { kind: 'set', value }
}
