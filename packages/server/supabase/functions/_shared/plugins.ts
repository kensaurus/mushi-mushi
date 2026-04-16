import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const pluginLog = log.child('plugins')

export interface PluginHooks {
  beforeClassify?(report: Record<string, unknown>): Promise<Record<string, unknown>>
  afterClassify?(report: Record<string, unknown>, classification: Record<string, unknown>): Promise<void>
  onReportCreated?(report: Record<string, unknown>): Promise<void>
  onStatusChanged?(report: Record<string, unknown>, oldStatus: string, newStatus: string): Promise<void>
}

interface PluginRecord {
  plugin_name: string
  plugin_version: string
  config: Record<string, unknown> | null
  execution_order: number
}

const PLUGIN_TIMEOUT = 5000

export async function getActivePlugins(db: SupabaseClient, projectId: string): Promise<PluginRecord[]> {
  const { data } = await db
    .from('project_plugins')
    .select('plugin_name, plugin_version, config, execution_order')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('execution_order', { ascending: true })

  return data ?? []
}

export async function executePluginHook<T>(
  plugins: PluginRecord[],
  hookName: string,
  args: unknown[],
): Promise<T | undefined> {
  let result: unknown

  for (const plugin of plugins) {
    try {
      const hookFn = resolveBuiltinHook(plugin.plugin_name, hookName, plugin.config)
      if (!hookFn) continue

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Plugin ${plugin.plugin_name} timed out`)), PLUGIN_TIMEOUT),
      )

      result = await Promise.race([hookFn(...args), timeoutPromise])
    } catch (err) {
      pluginLog.error('Plugin hook failed', { plugin: plugin.plugin_name, hook: hookName, err: String(err) })
    }
  }

  return result as T | undefined
}

function resolveBuiltinHook(
  pluginName: string,
  hookName: string,
  _config: Record<string, unknown> | null,
): ((...args: unknown[]) => Promise<unknown>) | null {
  // Built-in plugin implementations
  if (pluginName === 'severity-auto-escalation' && hookName === 'afterClassify') {
    return async (report: unknown, _classification: unknown) => {
      void report
    }
  }
  if (pluginName === 'sla-tracker' && hookName === 'onStatusChanged') {
    return async (report: unknown, _oldStatus: unknown, _newStatus: unknown) => {
      void report
    }
  }
  return null
}
