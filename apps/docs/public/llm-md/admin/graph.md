# Bug clusters (knowledge graph)

Source: https://kensaur.us/mushi-mushi/docs/admin/graph

---
title: Bug clusters (knowledge graph)
description: The Bug clusters page in Mushi Mushi graphs your bug groups, components, pages and fixes, so you see which bugs share a cause and what one fix might touch.
---

# Bug clusters (knowledge graph)

**Route:** `/graph` (sidebar: **Bug clusters**, under Bugs; the page was called Knowledge graph before)

The Bug clusters page draws the Mushi Mushi knowledge graph for your project: bug groups,
the components and pages they hit, and the fixes made for them. It is the quickest way
to see which bugs share a cause, so one fix can close several reports.

The page has three tabs:

| Tab | What it shows |
| --- | --- |
| **Overview** | A status banner, a summary of the most fragile areas, and how the map relates to Reports and Inventory |
| **Explore** | The map itself, as a **Graph**, a **Surface** (inventory overlay) or a **Table** |
| **Backend** | Apache AGE sync status, ontology tags and node groups, for debugging |

---

## Node types

| Node | What it is |
| ---- | ---------- |
| **Report group** | A group of similar reports |
| **Component** | A component reports were classified against |
| **Page** | A page reports came from |
| **Version** / **App** | The app and the version a report came from |
| **Page (inventory)**, **Element**, **Action** | Nodes from your `inventory.yaml` |
| **API**, **Database** | Backend dependencies from the inventory |
| **Test**, **User story** | Tests and user stories from the inventory |

Edges carry a type such as `causes`, `related_to`, `regression_of`, `duplicate_of`,
`affects`, `fix_attempted`, `fix_applied`, `fix_verified`, and the inventory edges
`contains`, `triggers`, `calls`, `reads`, `writes`, `reports_against` and `errors_on`.
The filters let you narrow both lists. Nodes with no links are hidden, and the canvas
says how many.

---

## Blast radius

Click any node (or focus it with Tab and press Enter or Space) to load its blast
radius: every node it can affect through the graph. The canvas dims everything else,
and the side panel lists the affected nodes along with the node's occurrences and when
it was first and last seen.

---

## Surface view

Choose **Surface** on the Explore tab to overlay your `inventory.yaml` on the bug graph:
user stories, inventory pages, elements, actions, API and database dependencies, tests
and apps, together with report groups.

Surface needs at least one accepted `inventory.yaml` proposal. See
[User stories · Inventory](/admin/inventory) for how to generate one.

---

## Backend tab

The graph is stored in SQL tables and can be mirrored into the Apache AGE Postgres
extension. The **Graph backend** card shows the backend mode (**SQL only**,
**SQL + AGE (dual-write)** or **AGE only**), whether the AGE extension is installed,
how many nodes and edges are not yet mirrored, and when the last drift audit ran.

  There is no Cypher query console in the console. To query the graph by hand, use the
  [SQL query](/admin/query) page (`graph_nodes`, `graph_edges`), or ask a blast-radius
  question there in plain English.

---

## API

```bash
GET /v1/admin/graph/stats
GET /v1/admin/graph/nodes
GET /v1/admin/graph/edges
GET /v1/admin/graph/blast-radius/:nodeId
```

---

## See also

- [Concepts → Knowledge graph](/concepts/knowledge-graph): the data model behind the graph.
- [User stories · Inventory](/admin/inventory): the inventory that Surface overlays.
- [Bugs](/admin/reports): open the detail view for any report.
