-- One knowledge-graph node per (project, type, label) for the bug-cluster types.
--
-- findOrCreateNode (_shared/knowledge-graph.ts) looked a node up with
-- `.single()`, which returns no row once two exist, and then inserted another.
-- So a single race became a duplicate that grew on every later call: on
-- 2026-11-13 prod had 11 groups and 98 extra rows (one page label 42 times),
-- and the Bug clusters graph drew the same page several times. The code now
-- takes the oldest row and re-reads after a unique violation; this merges the
-- copies into the oldest one and adds the index that keeps it that way.
--
-- Only the types the knowledge graph owns get the index. Inventory types
-- (app, page_v2, element, action, …) keep their own identity rules.

create temporary table _graph_node_merge on commit drop as
select id as dup_id, keeper_id
  from (
    select id,
           first_value(id) over (
             partition by project_id, node_type, label
             order by created_at, id
           ) as keeper_id
      from public.graph_nodes
     where node_type in ('page', 'component', 'version', 'report_group')
  ) ranked
 where id <> keeper_id;

-- Edges: work out each edge's ends after the merge. Drop edges that would
-- become a self-loop, keep one edge per final (source, target, type) — the
-- oldest — and repoint the survivors.
create temporary table _graph_edge_final on commit drop as
select e.id,
       e.created_at,
       coalesce(ms.keeper_id, e.source_node_id) as src,
       coalesce(mt.keeper_id, e.target_node_id) as tgt,
       e.edge_type
  from public.graph_edges e
  left join _graph_node_merge ms on ms.dup_id = e.source_node_id
  left join _graph_node_merge mt on mt.dup_id = e.target_node_id
 where e.source_node_id in (select dup_id from _graph_node_merge union select keeper_id from _graph_node_merge)
    or e.target_node_id in (select dup_id from _graph_node_merge union select keeper_id from _graph_node_merge);

delete from public.graph_edges e
 using (
   select id,
          src = tgt as self_loop,
          row_number() over (partition by src, tgt, edge_type order by created_at, id) as rn
     from _graph_edge_final
 ) f
 where e.id = f.id and (f.self_loop or f.rn > 1);

update public.graph_edges e set source_node_id = m.keeper_id
  from _graph_node_merge m where e.source_node_id = m.dup_id;
update public.graph_edges e set target_node_id = m.keeper_id
  from _graph_node_merge m where e.target_node_id = m.dup_id;

-- Other tables that point at graph nodes keep their rows on the keeper.
update public.fix_attempts t set inventory_action_node_id = m.keeper_id
  from _graph_node_merge m where t.inventory_action_node_id = m.dup_id;
update public.fix_dispatch_jobs t set inventory_action_node_id = m.keeper_id
  from _graph_node_merge m where t.inventory_action_node_id = m.dup_id;
update public.gate_findings t set node_id = m.keeper_id
  from _graph_node_merge m where t.node_id = m.dup_id;
update public.status_history t set node_id = m.keeper_id
  from _graph_node_merge m where t.node_id = m.dup_id;
update public.synthetic_runs t set action_node_id = m.keeper_id
  from _graph_node_merge m where t.action_node_id = m.dup_id;

delete from public.graph_nodes n using _graph_node_merge m where n.id = m.dup_id;

create unique index if not exists graph_nodes_one_per_label
  on public.graph_nodes (project_id, node_type, label)
  where node_type in ('page', 'component', 'version', 'report_group');
