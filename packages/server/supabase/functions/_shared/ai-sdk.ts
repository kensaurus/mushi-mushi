/**
 * FILE: packages/server/supabase/functions/_shared/ai-sdk.ts
 * PURPOSE: The AI SDK and model clients, in one module that callers load on
 *          first use: `const ai = await import('./ai-sdk.ts')`.
 *
 * The `api` function boots a fresh isolate on nearly every request (4,338
 * boots for 3,656 requests on 2026-10-15), and every module its entry file
 * reaches through static imports is evaluated before the first byte. `ai@4`
 * alone pulls in react, swr and jsondiffpatch; with the provider packages and
 * the Anthropic SDK it cost about as much to evaluate as hono, zod,
 * supabase-js and yaml together (measured locally, 2026-10-16). Only routes
 * that call a model need it, so it stays out of the static graph: import it
 * with a literal relative specifier (the deploy script follows those, and the
 * bundler includes the module), never statically from a route or a module a
 * route imports.
 */
export { generateObject, generateText, NoObjectGeneratedError, streamText, zodSchema } from 'npm:ai@4'
export { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
export { parsePartialJson } from 'npm:@ai-sdk/ui-utils@1'
export { default as Anthropic } from 'npm:@anthropic-ai/sdk@0.131.0'
