#!/usr/bin/env node
// ============================================================
// D6: mirror a `status:*` label change onto the Status
// single-select field of the public roadmap project.
//
// Inputs (env): GH_TOKEN, LABEL (e.g. status:in-flight), ITEM_NODE
//   (the issue/PR node_id; the project item itself is looked up).
//
// The project + field IDs are looked up at run time so this script
// keeps working when the project is recreated.
// ============================================================
import { execSync } from 'node:child_process'

const PROJECT_OWNER = 'kensaurus'
const PROJECT_NUMBER = 1
const STATUS_FIELD_NAME = 'Status'

const STATUS_MAP = {
  'status:planning': 'Backlog',
  'status:in-flight': 'In Progress',
  'status:in-review': 'In Review',
  'status:blocked': 'Blocked',
  'status:done': 'Done',
}

const label = process.env.LABEL
const itemNode = process.env.ITEM_NODE
if (!label || !itemNode) {
  console.error('LABEL and ITEM_NODE env vars are required')
  process.exit(1)
}

const targetStatus = STATUS_MAP[label]
if (!targetStatus) {
  console.log(`No status mapping for label "${label}" — skipping.`)
  process.exit(0)
}

const gh = (args) =>
  JSON.parse(execSync(`gh api graphql -f query=${JSON.stringify(args)}`, { encoding: 'utf8' }))

const projectQuery = `
  query {
    user(login: "${PROJECT_OWNER}") {
      projectV2(number: ${PROJECT_NUMBER}) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        items(first: 100) {
          nodes { id content { ... on Issue { id } ... on PullRequest { id } } }
        }
      }
    }
  }
`
const project = gh(projectQuery).data.user.projectV2
const statusField = project.fields.nodes.find((f) => f && f.name === STATUS_FIELD_NAME)
if (!statusField) {
  console.error(`Project has no "${STATUS_FIELD_NAME}" single-select field`)
  process.exit(1)
}
const optionId = statusField.options.find((o) => o.name === targetStatus)?.id
if (!optionId) {
  console.error(`No option "${targetStatus}" on field "${STATUS_FIELD_NAME}"`)
  process.exit(1)
}

const item = project.items.nodes.find((it) => it.content && it.content.id === itemNode)
if (!item) {
  console.log(`Item ${itemNode} not yet in project — add-to-project will run first; skipping.`)
  process.exit(0)
}

const mutation = `
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "${project.id}",
      itemId: "${item.id}",
      fieldId: "${statusField.id}",
      value: { singleSelectOptionId: "${optionId}" }
    }) { projectV2Item { id } }
  }
`
gh(mutation)
console.log(`Set ${itemNode} -> ${targetStatus}`)
