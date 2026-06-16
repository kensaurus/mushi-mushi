/**
 * FILE: console-knowledge-build/index.ts
 * PURPOSE: Service-role worker that embeds and upserts the console help corpus into pgvector.
 *
 * OVERVIEW:
 * - Reads bundled console-knowledge-corpus.json
 * - Embeds each chunk via createEmbedding (env OpenAI key)
 * - Upserts into console_knowledge_chunks; deletes stale doc_path+section rows
 *
 * TRIGGER: POST with Authorization: Bearer <service_role> (manual or CI deploy hook)
 *
 * NOTES:
 * - Plain Deno.serve handler (not Hono) — Supabase passes the function slug in the
 *   request path, so Hono `app.post('/')` never matches and returns 404.
 */

import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { withSentry } from '../_shared/sentry.ts';
import { getServiceClient } from '../_shared/db.ts';
import { createEmbedding, createEmbeddingBatch } from '../_shared/embeddings.ts';
import { log } from '../_shared/logger.ts';
import corpus from '../_shared/console-knowledge-corpus.json' with { type: 'json' };

interface CorpusDoc {
  doc_path: string;
  section: string;
  title: string;
  body: string;
  route_path: string | null;
  kind: string;
  content_hash: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function runBuild(): Promise<Response> {
  const db = getServiceClient();
  const docs = (corpus as { docs: CorpusDoc[] }).docs ?? [];
  if (docs.length === 0) {
    return jsonResponse({ ok: false, error: 'empty corpus' }, 400);
  }

  const started = Date.now();
  let upserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  const BATCH = 32;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    let embeddings: number[][] = [];
    try {
      embeddings = await createEmbeddingBatch(batch.map((d) => d.body));
    } catch {
      for (const d of batch) {
        try {
          const emb = await createEmbedding(d.body);
          embeddings.push(emb);
        } catch (e) {
          errors.push(`${d.doc_path}:${d.section}: ${e instanceof Error ? e.message : String(e)}`);
          embeddings.push([]);
        }
      }
    }

    for (let j = 0; j < batch.length; j++) {
      const d = batch[j];
      const embedding = embeddings[j];
      if (!embedding?.length) {
        skipped++;
        continue;
      }

      const { error } = await db.from('console_knowledge_chunks').upsert(
        {
          doc_path: d.doc_path,
          section: d.section,
          title: d.title,
          body: d.body,
          route_path: d.route_path,
          kind: d.kind,
          content_hash: d.content_hash,
          embedding,
          metadata: { source: 'build' },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'doc_path,section' },
      );

      if (error) {
        errors.push(`${d.doc_path}: ${error.message}`);
      } else {
        upserted++;
      }
    }
  }

  const keys = new Set(docs.map((d) => `${d.doc_path}::${d.section}`));
  const { data: existing } = await db
    .from('console_knowledge_chunks')
    .select('id, doc_path, section');
  const staleIds = (existing ?? [])
    .filter((row: { doc_path: string; section: string; id: string }) =>
      !keys.has(`${row.doc_path}::${row.section}`)
    )
    .map((row: { id: string }) => row.id);

  if (staleIds.length > 0) {
    await db.from('console_knowledge_chunks').delete().in('id', staleIds);
  }

  const latencyMs = Date.now() - started;
  log.info('console-knowledge-build complete', { upserted, skipped, stale: staleIds.length, latencyMs });

  return jsonResponse({
    ok: true,
    data: {
      upserted,
      skipped,
      removed: staleIds.length,
      total: docs.length,
      latencyMs,
      errors: errors.slice(0, 10),
    },
  });
}

Deno.serve(
  withSentry('console-knowledge-build', async (req: Request) => {
    const unauthorized = requireServiceRoleAuth(req);
    if (unauthorized) return unauthorized;

    if (req.method !== 'POST' && req.method !== 'GET') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
    }

    return runBuild();
  }),
);
