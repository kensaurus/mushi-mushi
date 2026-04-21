import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface DeviceContext {
  fingerprint: string
  ipAddress?: string
  /**
   * §3c: SDK-supplied SHA-256 hex of stable device characteristics.
   * When present we use this for the cross-account check because it
   * survives token rotation and IP changes.
   */
  fingerprintHash?: string
  /**
   * §3c: optional reporter user identifier (e.g. authenticated
   * userId from the host app). Used to count distinct users per device.
   */
  reporterUserId?: string
}

export interface AntiGamingResult {
  allowed: boolean
  flagged: boolean
  reason?: string
}

const CROSS_ACCOUNT_THRESHOLD = 5

export async function checkAntiGaming(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  device: DeviceContext | null,
): Promise<AntiGamingResult> {
  if (device?.fingerprintHash) {
    const crossAccountResult = await runCrossAccountCheck(db, projectId, reporterTokenHash, device)
    if (crossAccountResult.flagged) return crossAccountResult
  }

  if (device?.fingerprint) {
    const multiAccountResult = await runMultiAccountCheck(db, projectId, reporterTokenHash, device)
    if (multiAccountResult.flagged) return multiAccountResult
  }

  return runVelocityCheck(db, projectId, reporterTokenHash, device)
}

/**
 * §3c: detect the same physical device backing many distinct
 * reporter accounts. Stronger signal than the legacy multi-account check
 * because the SDK fingerprint hash is independent of the reporter token
 * (which the gamer can rotate freely).
 */
async function runCrossAccountCheck(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  device: DeviceContext,
): Promise<AntiGamingResult> {
  const { data: existing } = await db
    .from('reporter_devices')
    .select('id, reporter_tokens, ip_addresses, report_count, distinct_user_count, cross_account_flagged, flag_reason')
    .eq('project_id', projectId)
    .eq('fingerprint_hash', device.fingerprintHash!)
    .maybeSingle()

  if (!existing) {
    await db.from('reporter_devices').insert({
      project_id: projectId,
      device_fingerprint: device.fingerprint,
      fingerprint_hash: device.fingerprintHash!,
      reporter_tokens: [reporterTokenHash],
      ip_addresses: device.ipAddress ? [device.ipAddress] : [],
      report_count: 1,
      distinct_user_count: device.reporterUserId ? 1 : 0,
    })
    return { allowed: true, flagged: false }
  }

  const tokens: string[] = existing.reporter_tokens ?? []
  const ips: string[] = existing.ip_addresses ?? []
  if (!tokens.includes(reporterTokenHash)) tokens.push(reporterTokenHash)
  if (device.ipAddress && !ips.includes(device.ipAddress)) ips.push(device.ipAddress)

  // Use distinct reporter token count as a proxy for distinct users when no
  // explicit reporterUserId is supplied. Once we cross the threshold, set
  // the dedicated cross_account_flagged column so the admin UI can surface
  // it independently of the legacy `flagged_as_suspicious` column.
  const distinctUsers = Math.max(existing.distinct_user_count ?? 0, tokens.length)
  let crossFlagged = existing.cross_account_flagged ?? false
  let reason = existing.flag_reason ?? null
  if (distinctUsers >= CROSS_ACCOUNT_THRESHOLD && !crossFlagged) {
    crossFlagged = true
    reason = `Cross-account: ${distinctUsers} reporter identities share fingerprint hash`
  }

  await db.from('reporter_devices').update({
    reporter_tokens: tokens,
    ip_addresses: ips,
    report_count: (existing.report_count ?? 0) + 1,
    distinct_user_count: distinctUsers,
    cross_account_flagged: crossFlagged,
    flagged_as_suspicious: crossFlagged ? true : undefined,
    flag_reason: crossFlagged ? reason : existing.flag_reason ?? null,
  }).eq('id', existing.id)

  if (crossFlagged) return { allowed: true, flagged: true, reason: reason ?? undefined }
  return { allowed: true, flagged: false }
}

async function runMultiAccountCheck(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  device: DeviceContext,
): Promise<AntiGamingResult> {
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

  return { allowed: true, flagged: false }
}

async function runVelocityCheck(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  device: DeviceContext | null,
): Promise<AntiGamingResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .gte('created_at', since)

  if ((count ?? 0) > 10) {
    if (device?.fingerprint) {
      await db.from('reporter_devices').update({
        flagged_as_suspicious: true,
        flag_reason: `Velocity anomaly: ${count} reports in 24h`,
      }).eq('project_id', projectId).eq('device_fingerprint', device.fingerprint)
    }
    return { allowed: true, flagged: true, reason: `Velocity anomaly: ${count} reports in 24h` }
  }

  return { allowed: true, flagged: false }
}
