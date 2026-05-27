export interface Agent {
  id: string
  name: string
  role: string
  system_prompt: string
  model: string
  temperature: number
  max_tokens: number
  tools: string[]
  memory_enabled: boolean
  memory_window: number
  channels: ChannelConfig[]
  schedule: string | null
  guardrails: Record<string, unknown>
  skills: string[]
  created_at: string
  updated_at: string
}

export interface ChannelConfig {
  channel: 'telegram' | 'slack' | 'whatsapp'
  [key: string]: string
}

export interface WorkflowNode {
  id: string
  agent_id: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  condition: string
  label: string
  sourceHandle?: string
  targetHandle?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entry_point: string
  template_name: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface RunMessage {
  id: string
  run_id: string
  agent_id: string | null
  agent_name: string
  role: string
  content: string
  metadata_: Record<string, unknown>
  created_at: string
}

export interface WorkflowRun {
  id: string
  workflow_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger_source: string
  trigger_data: Record<string, unknown>
  input_message: string
  output_message: string | null
  tokens_used: number
  estimated_cost: number
  started_at: string
  completed_at: string | null
  messages: RunMessage[]
}

export interface AvailableTool {
  name: string
  description: string
}

export type WsEvent = {
  type: string
  run_id: string
  timestamp: string
  data: Record<string, unknown>
}
