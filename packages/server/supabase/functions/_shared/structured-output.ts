import type { ZodType } from 'npm:zod@3'

export interface StructuredObjectUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface ValidatedObjectResult<T> {
  object: T
  usage?: StructuredObjectUsage
  experimental_providerMetadata?: unknown
}

type GenerateObjectCompat = (
  options: Record<string, unknown>,
) => Promise<{
  object: unknown
  usage?: StructuredObjectUsage
  experimental_providerMetadata?: unknown
}>

// AI SDK 4's generateObject generic can exceed TypeScript 6 / Deno's
// instantiation depth when a large Edge Function graph is checked. Keep the
// provider boundary shallow, then restore stronger safety by parsing the
// returned object through the caller's Zod schema before it can be consumed.
// ai@4 loads on the first call, not at boot (ai-sdk.ts).
export async function generateValidatedObject<T>(
  schema: ZodType<T>,
  options: Record<string, unknown>,
): Promise<ValidatedObjectResult<T>> {
  const { generateObject } = await import('./ai-sdk.ts')
  const generateObjectCompat = generateObject as unknown as GenerateObjectCompat
  const result = await generateObjectCompat({ ...options, schema })
  return {
    ...result,
    object: schema.parse(result.object),
  }
}
