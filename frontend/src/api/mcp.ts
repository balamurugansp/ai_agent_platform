import { api } from './client'
import type { AxiosResponse } from 'axios'

export interface MCPServer {
  id: string
  name: string
  description: string
  transport: 'stdio' | 'sse' | 'websocket'
  url?: string
  command?: string
  args: string[]
  env: Record<string, string>
  capabilities: {
    tools?: Array<{ name: string; description: string; inputSchema?: object }>
    prompts?: Array<{ name: string; description: string }>
    resources?: Array<{ name: string; uri: string; mimeType?: string }>
  }
  is_active: boolean
  status: 'connected' | 'disconnected' | 'error'
  error_message?: string
  last_connected_at?: string
  created_at: string
}

export interface HITLCheckpoint {
  id: string
  run_id: string
  workflow_id: string
  node_id: string
  agent_id: string
  agent_name: string
  prompt?: string
  status: 'pending' | 'approved' | 'rejected' | 'timeout'
  feedback?: string
  context_snapshot?: Record<string, unknown>
  reviewer?: string
  created_at: string
  resolved_at?: string
  expires_at?: string
}

const d = <T>(p: Promise<AxiosResponse<T>>): Promise<T> => p.then((r) => r.data)

// ── MCP Servers ──────────────────────────────────────────────────────────────
export const getMCPServers = (): Promise<MCPServer[]> =>
  d(api.get<MCPServer[]>('/mcp/servers'))

export const createMCPServer = (data: Partial<MCPServer>): Promise<MCPServer> =>
  d(api.post<MCPServer>('/mcp/servers', data))

export const updateMCPServer = (id: string, data: Partial<MCPServer>): Promise<MCPServer> =>
  d(api.patch<MCPServer>(`/mcp/servers/${id}`, data))

export const deleteMCPServer = (id: string): Promise<void> =>
  api.delete(`/mcp/servers/${id}`).then(() => undefined)

export const connectMCPServer = (id: string): Promise<MCPServer> =>
  d(api.post<MCPServer>(`/mcp/servers/${id}/connect`))

export const disconnectMCPServer = (id: string): Promise<MCPServer> =>
  d(api.post<MCPServer>(`/mcp/servers/${id}/disconnect`))

// ── MCP Execution ────────────────────────────────────────────────────────────
export const callMCPTool = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> =>
  d(api.post('/mcp/tools/call', {
    server_id: serverId,
    tool_name: toolName,
    arguments: args,
  }))

export const getMCPPrompt = (
  serverId: string,
  promptName: string,
  args: Record<string, unknown>,
): Promise<unknown> =>
  d(api.post('/mcp/prompts/get', {
    server_id: serverId,
    prompt_name: promptName,
    arguments: args,
  }))

export const readMCPResource = (serverId: string, uri: string): Promise<unknown> =>
  d(api.post('/mcp/resources/read', { server_id: serverId, resource_uri: uri }))

// ── Dead-Letter Queue ────────────────────────────────────────────────────────
export const getDLQ = (): Promise<unknown[]> =>
  d(api.get<unknown[]>('/mcp/dlq'))

export const clearDLQ = (): Promise<void> =>
  api.delete('/mcp/dlq').then(() => undefined)

// ── HITL ─────────────────────────────────────────────────────────────────────
export const getCheckpoints = (status?: string): Promise<HITLCheckpoint[]> =>
  d(api.get<HITLCheckpoint[]>('/hitl/checkpoints', {
    params: status && status !== 'all' ? { status } : undefined,
  }))

export const getPendingCheckpoints = (): Promise<string[]> =>
  d(api.get<string[]>('/hitl/checkpoints/pending'))

export const resolveCheckpoint = (
  id: string,
  decision: 'approved' | 'rejected',
  feedback?: string,
  reviewer = 'human',
): Promise<HITLCheckpoint> =>
  d(api.post<HITLCheckpoint>(`/hitl/checkpoints/${id}/resolve`, {
    approved: decision === 'approved',
    feedback: feedback ?? '',
    reviewer,
  }))

export const getCheckpoint = (id: string): Promise<HITLCheckpoint> =>
  d(api.get<HITLCheckpoint>(`/hitl/checkpoints/${id}`))
