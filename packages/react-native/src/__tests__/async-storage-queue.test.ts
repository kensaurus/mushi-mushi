import { describe, it, expect } from 'vitest'
import { buildOfflineFlushHeaders } from '../storage/async-storage-queue'

describe('buildOfflineFlushHeaders', () => {
  it('includes project, SDK package/version, and user token headers', () => {
    const headers = buildOfflineFlushHeaders({
      apiEndpoint: 'https://api.example.com',
      apiKey: 'mushi_test_key',
      projectId: 'proj-abc',
      sdkPackage: '@mushi-mushi/react-native',
      sdkVersion: '0.19.0',
      getUserToken: () => 'eyJhbG.test.token',
    })

    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': 'mushi_test_key',
      'X-Mushi-Project': 'proj-abc',
      'X-Mushi-SDK-Package': '@mushi-mushi/react-native',
      'X-Mushi-SDK-Version': '0.19.0',
      'X-Mushi-User-Token': 'eyJhbG.test.token',
      'X-Mushi-Internal': 'report-submit',
    })
  })

  it('omits user token header when anonymous', () => {
    const headers = buildOfflineFlushHeaders({
      apiEndpoint: 'https://api.example.com',
      apiKey: 'mushi_test_key',
      projectId: 'proj-abc',
      getUserToken: () => null,
    })

    expect(headers['X-Mushi-User-Token']).toBeUndefined()
    expect(headers['X-Mushi-Project']).toBe('proj-abc')
  })
})
