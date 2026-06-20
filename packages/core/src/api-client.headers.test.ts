import { describe, it, expect } from 'vitest'
import { buildSdkIngestHeaders } from './api-client'

describe('buildSdkIngestHeaders', () => {
  it('mirrors the authenticated SDK request header set', () => {
    const headers = buildSdkIngestHeaders({
      apiKey: 'key',
      projectId: 'pid',
      sdkPackage: '@mushi-mushi/core',
      sdkVersion: '1.19.0',
      userToken: 'jwt',
      internalKind: 'report-submit',
    })
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': 'key',
      'X-Mushi-Project': 'pid',
      'X-Mushi-SDK-Package': '@mushi-mushi/core',
      'X-Mushi-SDK-Version': '1.19.0',
      'X-Mushi-User-Token': 'jwt',
      'X-Mushi-Internal': 'report-submit',
    })
  })
})
