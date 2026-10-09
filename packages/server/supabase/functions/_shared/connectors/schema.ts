/**
 * FILE: packages/server/supabase/functions/_shared/connectors/schema.ts
 * PURPOSE: Zod validation of every ConnectorSnapshot (Plan 019 §2b): a
 *          connector that returns invalid data yields an `error` element,
 *          never `ok`. The generic HTTP connector's remote payload goes
 *          through the same schema.
 */

import { z } from 'npm:zod@3'
import { RECIPE_ELEMENT_KEYS } from '../recipe-types.ts'
import type { ConnectorSnapshot } from './types.ts'

const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()])

const fragment = z.object({
  state: z.enum(['ok', 'drift', 'unknown', 'not_connected', 'error']).optional(),
  summary: z.record(z.string().max(80), scalar),
  detail: z.record(z.string().max(80), z.unknown()).optional(),
})

export const connectorSnapshotSchema = z.object({
  observedAt: z.string().datetime(),
  elements: z.object(Object.fromEntries(RECIPE_ELEMENT_KEYS.map((k) => [k, fragment.optional()])) as Record<string, z.ZodOptional<typeof fragment>>).strict(),
  resources: z.array(z.object({
    kind: z.string().min(1).max(40),
    externalId: z.string().min(1).max(300),
    role: z.string().min(1).max(60),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).max(500),
  facts: z.record(z.string(), z.unknown()),
  cursor: z.string().max(500).optional(),
})

export type SnapshotValidation = { ok: true; snapshot: ConnectorSnapshot } | { ok: false; error: string }

export function validateSnapshot(raw: unknown): SnapshotValidation {
  const parsed = connectorSnapshotSchema.safeParse(raw)
  if (parsed.success) return { ok: true, snapshot: parsed.data as ConnectorSnapshot }
  return { ok: false, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}
