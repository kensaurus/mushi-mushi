#!/usr/bin/env node
// ============================================================
// Wave D D6: bootstrap the public Mushi roadmap (Projects v2).
//
// Idempotent. Run once by a maintainer with the `project` scope:
//
//   gh auth refresh -s project,read:org
//   node scripts/bootstrap-roadmap.mjs
//
// Creates (if missing) the user-owned `Mushi Mushi roadmap` project
// with these single-select fields + canonical options:
//
//   * Status   = Backlog | In Progress | In Review | Blocked | Done
//   * Wave     = A | B | C | D | E
//   * Area     = Web SDK | Mobile SDK | Admin | Server | LLM Pipeline |
//                Knowledge Graph | Fix Orchestrator | Plugins | Billing |
//                Docs | Security
//   * Impact   = P0 | P1 | P2 | P3
//   * Type     = Bug | Enhancement | RFC | Docs | Ops
//
// Then sets the project visibility to PUBLIC.
//
// Why a script: GitHub doesn't ship roadmaps as code yet. This script
// keeps the board reproducible.
// ============================================================
import { execSync } from 'node:child_process'

const OWNER = 'kensaurus'
const PROJECT_TITLE = 'Mushi Mushi roadmap'

const FIELDS = [
  {
    name: 'Status',
    options: ['Backlog', 'In Progress', 'In Review', 'Blocked', 'Done'],
  },
  { name: 'Wave', options: ['A', 'B', 'C', 'D', 'E'] },
  {
    name: 'Area',
    options: [
      'Web SDK',
      'Mobile SDK',
      'Admin',
      'Server',
      'LLM Pipeline',
      'Knowledge Graph',
      'Fix Orchestrator',
      'Plugins',
      'Billing',
      'Docs',
      'Security',
    ],
  },
  { name: 'Impact', options: ['P0', 'P1', 'P2', 'P3'] },
  {
    name: 'Type',
    options: ['Bug', 'Enhancement', 'RFC', 'Docs', 'Ops'],
  },
]

const gql = (query) => {
  const out = execSync(`gh api graphql -f query=${JSON.stringify(query)}`, {
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

const findProject = () =>
  gql(`
    query {
      user(login: "${OWNER}") {
        id
        projectsV2(first: 50) { nodes { id title number url public } }
      }
    }
  `).data.user

const ensureProject = () => {
  const user = findProject()
  const existing = user.projectsV2.nodes.find((p) => p.title === PROJECT_TITLE)
  if (existing) {
    console.log(`Project exists: ${existing.url} (#${existing.number})`)
    return existing
  }
  console.log(`Creating project "${PROJECT_TITLE}" under ${OWNER}…`)
  const created = gql(`
    mutation {
      createProjectV2(input: { ownerId: "${user.id}", title: ${JSON.stringify(PROJECT_TITLE)} }) {
        projectV2 { id title number url public }
      }
    }
  `).data.createProjectV2.projectV2
  console.log(`Created: ${created.url}`)
  return created
}

const fetchFields = (projectId) =>
  gql(`
    query {
      node(id: "${projectId}") {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id name options { id name }
              }
            }
          }
        }
      }
    }
  `).data.node.fields.nodes.filter(Boolean)

const ensureField = (projectId, fieldSpec) => {
  const existing = fetchFields(projectId).find((f) => f.name === fieldSpec.name)
  if (existing) {
    console.log(`Field exists: ${fieldSpec.name}`)
    return
  }
  console.log(`Creating field: ${fieldSpec.name}`)
  const opts = fieldSpec.options
    .map((o) => `{ name: ${JSON.stringify(o)}, color: GRAY, description: "" }`)
    .join(',')
  gql(`
    mutation {
      createProjectV2Field(input: {
        projectId: "${projectId}",
        dataType: SINGLE_SELECT,
        name: ${JSON.stringify(fieldSpec.name)},
        singleSelectOptions: [${opts}]
      }) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
    }
  `)
}

const makePublic = (projectId) => {
  console.log('Setting project visibility to PUBLIC…')
  gql(`
    mutation {
      updateProjectV2(input: { projectId: "${projectId}", public: true }) {
        projectV2 { id public url }
      }
    }
  `)
}

const main = () => {
  const project = ensureProject()
  for (const f of FIELDS) ensureField(project.id, f)
  if (!project.public) makePublic(project.id)
  console.log('\nDone. Roadmap is live at:', project.url)
  console.log('\nNext step: copy the project node-id into the')
  console.log('  ROADMAP_PROJECT_TOKEN GitHub Action secret URL.')
  console.log('  Project node-id:', project.id)
}

main()
