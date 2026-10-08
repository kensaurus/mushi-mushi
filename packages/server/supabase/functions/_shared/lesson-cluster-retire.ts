/**
 * FILE: packages/server/supabase/functions/_shared/lesson-cluster-retire.ts
 * PURPOSE: Retiring a lesson also retires the mistake cluster it was promoted
 *          from. The clusterer only skips `retired` clusters, so a cluster
 *          left `promoted` kept pulling new reports into a rule nobody uses.
 */

interface ClusterUpdateQuery {
  eq(column: string, value: unknown): ClusterUpdateQuery
  select(columns: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

/** The slice of the Supabase client this needs (kept narrow for tests). */
export interface ClusterRetireDb {
  from(table: 'mistake_clusters'): {
    update(patch: { status: 'retired'; updated_at: string }): ClusterUpdateQuery
  }
}

/**
 * Marks the lesson's source cluster `retired`, but only when it is still
 * `promoted` and belongs to the lesson's project (a candidate or an already
 * retired cluster is left alone). Returns how many clusters changed (0 or 1).
 */
export async function retirePromotedCluster(
  db: ClusterRetireDb,
  clusterId: string | null | undefined,
  projectId: string,
  now: Date = new Date(),
): Promise<{ retired: number; error: string | null }> {
  if (!clusterId) return { retired: 0, error: null }
  const { data, error } = await db
    .from('mistake_clusters')
    .update({ status: 'retired', updated_at: now.toISOString() })
    .eq('id', clusterId)
    .eq('project_id', projectId)
    .eq('status', 'promoted')
    .select('id')
  if (error) return { retired: 0, error: error.message }
  return { retired: data?.length ?? 0, error: null }
}
