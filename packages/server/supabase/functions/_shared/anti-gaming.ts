import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface DeviceContext {
  fingerprint: string
  ipAddress?: string
}

export interface AntiGamingResult {
  allowed: boolean
  flagged: boolean
  reason?: string
}

export async function checkAntiGaming(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  device: DeviceContext | null,
): Promise<AntiGamingResult> {
  if (!device?.fingerprint) return { allowed: true, flagged: false }

  const { data: existing } = await db
    .from('reporter_devices')
    .select('*')
    .eq('project_id', projectId)
    .eq('device_fingerprint', device.fingerprint)
    .single()

  if (existing) {
    const tokens = existing.reporter_tokens ?? []
    const ips = existing.ip_addresses ?? []

    if (!tokens.includes(reporterTokenHash)) {
      tokens.push(reporterTokenHash)
    }
    if (device.ipAddress && !ips.includes(device.ipAddress)) {
      ips.push(device.ipAddress)
    }

    let flagged = existing.flagged_as_suspicious
    let reason = existing.flag_reason

    // Multi-account detection
    if (tokens.length > 3 && !flagged) {
      flagged = true
      reason = `Multi-account: ${tokens.length} reporter tokens from same device`
    }

    await db.from('reporter_devices').update({
      reporter_tokens: tokens,
      ip_addresses: ips,
      report_count: (existing.report_count ?? 0) + 1,
      flagged_as_suspicious: flagged,
      flag_reason: reason,
    }).eq('id', existing.id)

    if (flagged) {
      return { allowed: true, flagged: true, reason: reason ?? undefined }
    }
  } else {
    await db.from('reporter_devices').insert({
      project_id: projectId,
      device_fingerprint: device.fingerprint,
      reporter_tokens: [reporterTokenHash],
      ip_addresses: device.ipAddress ? [device.ipAddress] : [],
      report_count: 1,
    })
  }

  // Velocity check: > 10 reports in 24h from same reporter
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .gte('created_at', since)

  if ((count ?? 0) > 10) {
    await db.from('reporter_devices').update({
      flagged_as_suspicious: true,
      flag_reason: `Velocity anomaly: ${count} reports in 24h`,
    }).eq('project_id', projectId).eq('device_fingerprint', device.fingerprint)

    return { allowed: true, flagged: true, reason: `Velocity anomaly: ${count} reports in 24h` }
  }

  return { allowed: true, flagged: false }
}
