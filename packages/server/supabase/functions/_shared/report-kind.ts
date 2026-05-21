const ADMIN_PIPELINE_TEST_URL = 'admin://test-report'
const ADMIN_PIPELINE_TEST_SOURCE = 'admin_test_report'

export const ADMIN_PIPELINE_TEST_DISPATCH_ERROR =
  'Admin pipeline test reports are diagnostics and cannot be dispatched for autofix.'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

export function isAdminPipelineTestReport(report: {
  custom_metadata?: unknown
  metadata?: unknown
  environment?: unknown
}): boolean {
  const customMetadata = asRecord(report.custom_metadata)
  const legacyMetadata = asRecord(report.metadata)
  const environment = asRecord(report.environment)

  return (
    customMetadata.source === ADMIN_PIPELINE_TEST_SOURCE ||
    legacyMetadata.source === ADMIN_PIPELINE_TEST_SOURCE ||
    environment.url === ADMIN_PIPELINE_TEST_URL
  )
}
