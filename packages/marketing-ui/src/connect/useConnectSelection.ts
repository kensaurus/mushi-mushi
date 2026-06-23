/**
 * FILE: connect/useConnectSelection.ts
 * PURPOSE: Client + lane selection state with localStorage persistence.
 */

import { useCallback, useState } from 'react'
import { MCP_CLIENTS, type McpClientDef, type McpClientId } from '@mushi-mushi/mcp/clients'
import type { ConnectLane } from './types'

const DEFAULT_STORAGE_KEY = 'mushi_selected_client'

function readStoredClient(storageKey: string): McpClientId {
  if (typeof window === 'undefined') return 'cursor'
  try {
    const v = localStorage.getItem(storageKey)
    if (v && MCP_CLIENTS.some((c) => c.id === v)) return v as McpClientId
  } catch {
    /* SSR / permissions */
  }
  return 'cursor'
}

function persistClient(storageKey: string, id: McpClientId) {
  try {
    localStorage.setItem(storageKey, id)
  } catch {
    /* ignore */
  }
}

export interface UseConnectSelectionOptions {
  storageKey?: string
  initialLane?: ConnectLane
}

export function useConnectSelection(options: UseConnectSelectionOptions = {}) {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const [selectedId, setSelectedId] = useState<McpClientId>(() => readStoredClient(storageKey))
  const [activeLane, setActiveLane] = useState<ConnectLane>(options.initialLane ?? 'mcp')

  const selectClient = useCallback(
    (id: McpClientId) => {
      setSelectedId(id)
      persistClient(storageKey, id)
    },
    [storageKey],
  )

  const selectedClient: McpClientDef =
    MCP_CLIENTS.find((c) => c.id === selectedId) ?? MCP_CLIENTS[0]!

  return {
    selectedId,
    selectedClient,
    activeLane,
    setActiveLane,
    selectClient,
    clients: MCP_CLIENTS,
  }
}
