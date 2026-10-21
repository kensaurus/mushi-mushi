/**
 * FILE: apps/admin/src/components/settings/cursorModelSpec.ts
 * PURPOSE: Turn a Cursor model list plus the operator's choices into the
 *          spec string parseCursorModelSpec accepts
 *          (`id` or `id?param=value&…`). Shared by spend-down and Integrations.
 */

export interface CursorModelParamValue {
  value: string
  displayName?: string
}

export interface CursorModelParam {
  id: string
  displayName?: string
  values: CursorModelParamValue[]
}

export interface CursorModelOption {
  id: string
  displayName?: string
  parameters?: CursorModelParam[]
}

/** Select value for a model id that is not in the account's list. */
export const CURSOR_MODEL_OTHER = '__other'

export interface CursorModelSelection {
  /** '' = account / app default, a model id, or CURSOR_MODEL_OTHER. */
  modelId: string
  /** Full spec when modelId is OTHER. */
  custom: string
  params: Record<string, string>
}

function readParams(query: string): Record<string, string> | null {
  const params: Record<string, string> = {}
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    params[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return params
}

/**
 * Which controls show the saved spec. Until the list has loaded, an unknown
 * id stays selected so the field does not flash into "Other".
 */
export function cursorModelSelection(
  spec: string,
  models: CursorModelOption[],
  listReady: boolean,
): CursorModelSelection {
  const text = spec.trim()
  if (!text) return { modelId: '', custom: '', params: {} }
  const q = text.indexOf('?')
  const id = (q < 0 ? text : text.slice(0, q)).trim()
  const params = q < 0 ? {} : readParams(text.slice(q + 1))
  if (!params || !models.some((m) => m.id === id)) {
    if (listReady || !params) return { modelId: CURSOR_MODEL_OTHER, custom: text, params: {} }
    return { modelId: id, custom: '', params }
  }
  return { modelId: id, custom: '', params }
}

/** What parseCursorModelSpec on the server accepts as a param key or value. */
const PLAIN_PARAM = /^[A-Za-z0-9_.-]{1,40}$/

export function isPlainParam(text: string): boolean {
  return PLAIN_PARAM.test(text)
}

/**
 * Spec for a list choice. Parameter order follows the model's own list.
 * A key or value the server would refuse (e.g. containing & = ?) is left out.
 */
export function cursorModelSpec(
  modelId: string,
  custom: string,
  params: Record<string, string>,
  model: CursorModelOption | undefined,
): string {
  if (!modelId) return ''
  if (modelId === CURSOR_MODEL_OTHER) return custom.trim()
  const q = (model?.parameters ?? [])
    .filter((p) => params[p.id] && isPlainParam(p.id) && isPlainParam(params[p.id]))
    .map((p) => `${p.id}=${params[p.id]}`)
  return q.length > 0 ? `${modelId}?${q.join('&')}` : modelId
}
