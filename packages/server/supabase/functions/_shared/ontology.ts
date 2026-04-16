import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface OntologyTag {
  tag: string
  parent_tag: string | null
  description: string | null
  usage_count: number
}

export async function getAvailableTags(
  db: SupabaseClient,
  projectId: string,
): Promise<OntologyTag[]> {
  const { data } = await db
    .from('bug_ontology')
    .select('tag, parent_tag, description, usage_count')
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .order('usage_count', { ascending: false })
    .limit(100)

  return data ?? []
}

export function formatTagsForPrompt(tags: OntologyTag[]): string {
  const roots = tags.filter(t => !t.parent_tag)
  const children = tags.filter(t => t.parent_tag)

  let result = 'Available bug ontology tags:\n'
  for (const root of roots) {
    result += `- ${root.tag}: ${root.description ?? ''}\n`
    for (const child of children.filter(c => c.parent_tag === root.tag)) {
      result += `  - ${child.tag}: ${child.description ?? ''}\n`
    }
  }
  return result
}

export async function applyTags(
  db: SupabaseClient,
  reportId: string,
  projectId: string,
  tags: string[],
): Promise<void> {
  if (!tags.length) return

  await db.from('reports').update({ bug_ontology_tags: tags }).eq('id', reportId)

  for (const tag of tags) {
    await db.rpc('increment_ontology_usage', { p_tag: tag, p_project_id: projectId }).catch(() => {
      // tag may not exist yet — create it
      db.from('bug_ontology').insert({
        project_id: projectId,
        tag,
        description: `Auto-created from report classification`,
      }).then(() => {}).catch(() => {})
    })
  }
}
