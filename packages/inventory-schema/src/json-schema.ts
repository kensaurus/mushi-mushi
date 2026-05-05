/**
 * Hand-authored JSON Schema (draft-07) version of the Zod inventory schema.
 *
 * Why not auto-generate?
 *   `zod-to-json-schema` is the obvious option but pulls a transitive
 *   surface that's bigger than the schema itself. The inventory shape is
 *   small (≈10 nested objects) and changes infrequently, so a hand-written
 *   companion ships with no extra dependency. The included unit test
 *   (`json-schema.test.ts`) pins each enum, pattern, and required-field
 *   list against the Zod side and round-trips a known-good fixture to
 *   keep the two validators from drifting silently.
 *
 * Consumers:
 *   - VS Code yaml plugin (yaml.schemas) → editor autocomplete
 *   - GitHub Actions setup-mushi-mushi → repo-level schema drop
 */

export const inventoryJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://mushimushi.dev/schemas/inventory-2.0.json',
  title: 'Mushi Mushi inventory.yaml (v2.0)',
  type: 'object',
  required: ['schema_version', 'app', 'pages'],
  additionalProperties: false,
  properties: {
    schema_version: {
      type: 'string',
      pattern: '^2(\\.\\d+)*$',
      description: 'Inventory schema version. Must start with "2." for the v2 admin to consume it.',
    },
    app: {
      type: 'object',
      required: ['id', 'name', 'base_url'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        base_url: { type: 'string', format: 'uri' },
        preview_url: { type: 'string', format: 'uri' },
        staging_url: { type: 'string', format: 'uri' },
        auth: {
          type: 'object',
          required: ['type', 'config'],
          properties: {
            type: { enum: ['cookie', 'bearer', 'oauth', 'scripted'] },
            config: { type: 'object' },
          },
        },
        extensions: { type: 'object' },
      },
    },
    user_stories: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          persona: { type: 'string' },
          description: { type: 'string' },
          goal: { type: 'string' },
          pages: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    pages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'path'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          user_story: { type: 'string' },
          auth_required: { type: 'boolean' },
          notes: { type: 'string' },
          elements: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'type', 'action'],
              properties: {
                id: { type: 'string' },
                type: {
                  enum: ['button', 'link', 'form', 'input', 'list', 'toggle', 'menu', 'image', 'media', 'other'],
                },
                action: { type: 'string' },
                backend: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['method', 'path'],
                    properties: {
                      method: { enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
                      path: { type: 'string' },
                    },
                  },
                },
                db_writes: { type: 'array', items: dbDepJsonShape() },
                db_reads: { type: 'array', items: dbDepJsonShape() },
                crud: { enum: ['C', 'R', 'U', 'D', 'none'] },
                verified_by: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['file', 'name'],
                    properties: {
                      file: { type: 'string' },
                      name: { type: 'string' },
                      framework: { enum: ['playwright', 'vitest', 'jest', 'cypress', 'other'] },
                    },
                  },
                },
                user_story: { type: 'string' },
                status: { enum: ['stub', 'mocked', 'wired', 'verified', 'regressed', 'unknown'] },
                last_verified: { type: 'string', format: 'date-time' },
                notes: { type: 'string' },
                owner_team: { type: 'string' },
                testid: { type: 'string' },
              },
            },
          },
        },
      },
    },
    dependencies: {
      type: 'object',
      properties: {
        apis: {
          type: 'array',
          items: {
            type: 'object',
            required: ['method', 'path'],
            properties: {
              id: { type: 'string' },
              method: { enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
              path: { type: 'string' },
              schema_url: { type: 'string', format: 'uri' },
              owner_team: { type: 'string' },
              notes: { type: 'string' },
            },
          },
        },
        databases: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type'],
            properties: {
              id: { type: 'string' },
              type: { enum: ['postgres', 'mysql', 'mongodb', 'firestore', 'supabase', 'sqlite', 'other'] },
              schema_introspection_url: { type: 'string', format: 'uri' },
              adapter: { type: 'string' },
              notes: { type: 'string' },
            },
          },
        },
      },
    },
    extensions: { type: 'object' },
  },
} as const

function dbDepJsonShape() {
  return {
    type: 'object',
    required: ['table'],
    properties: {
      table: { type: 'string' },
      schema: { type: 'string' },
      operation: { enum: ['insert', 'update', 'delete', 'upsert', 'select'] },
      rpc: { type: 'string' },
    },
  }
}
