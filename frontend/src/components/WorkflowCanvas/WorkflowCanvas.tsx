import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Connection, type Node, type Edge,
  BackgroundVariant, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Save, Play, X, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import AgentNode from './AgentNode'
import type { Agent, Workflow } from '../../types'
import { workflowsApi } from '../../api/workflows'

const nodeTypes = { agentNode: AgentNode }

interface Props {
  workflow: Workflow
  agents: Agent[]
  onRunStarted?: (runId: string) => void
  onSaved?: (wf: Workflow) => void
}

export default function WorkflowCanvas({ workflow, agents, onRunStarted, onSaved }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(toFlowNodes(workflow, agents) as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(workflow) as Edge[])
  const [runInput, setRunInput] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [showEdgeModal, setShowEdgeModal] = useState<{ edge: Edge } | null>(null)
  const [edgeCondition, setEdgeCondition] = useState('')

  // Sync when workflow prop changes
  useEffect(() => {
    setNodes(toFlowNodes(workflow, agents) as Node[])
    setEdges(toFlowEdges(workflow) as Edge[])
  }, [workflow.id])

  const onConnect = useCallback((params: Connection) => {
    const edge: Edge = {
      ...params,
      id: `edge_${Date.now()}`,
      type: 'default',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4f6ef7' },
      style: { stroke: '#4f6ef7' },
      data: { condition: '', label: '' },
    }
    setEdges(es => addEdge(edge, es))
  }, [])

  const addAgentNode = (agent: Agent) => {
    const id = `node_${Date.now()}`
    const newNode: Node = {
      id,
      type: 'agentNode',
      position: { x: 100 + nodes.length * 280, y: 200 },
      data: {
        label: agent.name,
        agent_id: agent.id,
        role: agent.role,
        tools: agent.tools,
        memory_enabled: agent.memory_enabled,
      },
    }
    setNodes(ns => [...ns, newNode] as Node[])
    setShowAgentPicker(false)
    toast.success(`Added ${agent.name}`)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const wfNodes = nodes.map(n => ({
        id: n.id,
        agent_id: n.data.agent_id as string,
        position: n.position,
        data: n.data,
      }))
      const wfEdges = edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        condition: (e.data?.condition as string) || '',
        label: (e.data?.label as string) || '',
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }))
      const entryPoint = nodes[0]?.id || ''
      const saved = await workflowsApi.update(workflow.id, {
        nodes: wfNodes,
        edges: wfEdges,
        entry_point: entryPoint,
      })
      toast.success('Workflow saved!')
      onSaved?.(saved)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async () => {
    if (!runInput.trim()) { toast.error('Enter a message to run'); return }
    setRunning(true)
    try {
      const run = await workflowsApi.run(workflow.id, runInput)
      toast.success(`Run started: ${run.id.slice(0, 8)}...`)
      onRunStarted?.(run.id)
      setRunInput('')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRunning(false)
    }
  }

  const openEdgeCondition = (edge: Edge) => {
    setEdgeCondition((edge.data?.condition as string) || '')
    setShowEdgeModal({ edge })
  }

  const saveEdgeCondition = () => {
    if (!showEdgeModal) return
    setEdges(es => es.map(e =>
      e.id === showEdgeModal.edge.id
        ? { ...e, data: { ...e.data, condition: edgeCondition, label: edgeCondition },
            label: edgeCondition || undefined }
        : e
    ))
    setShowEdgeModal(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800">
        <span className="text-sm font-medium text-gray-300 truncate max-w-[200px]">{workflow.name}</span>
        <div className="flex-1" />

        <button onClick={() => setShowAgentPicker(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white">
          <Plus className="w-3.5 h-3.5" /> Agent
        </button>

        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
        </button>

        <div className="flex items-center gap-2 border-l border-gray-700 pl-3">
          <input
            value={runInput}
            onChange={e => setRunInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRun()}
            placeholder="Test input message…"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white w-52 focus:outline-none focus:border-brand-500"
          />
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-sm text-white disabled:opacity-50">
            <Play className="w-3.5 h-3.5" /> {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={(_, edge) => openEdgeCondition(edge)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={{
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#4f6ef7' },
            style: { stroke: '#4f6ef7' },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} color="#1f2937" />
          <Controls />
          <MiniMap nodeColor="#374151" maskColor="rgba(0,0,0,0.6)" />
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <AlertCircle className="w-10 h-10 text-gray-600 mb-3" />
            <p className="text-gray-500 text-sm">No agents yet.</p>
            <p className="text-gray-600 text-xs mt-1">Click "+ Agent" to add one.</p>
          </div>
        )}
      </div>

      {/* Agent Picker Modal */}
      {showAgentPicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-96 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h3 className="font-medium text-white">Add Agent to Canvas</h3>
              <button onClick={() => setShowAgentPicker(false)}>
                <X className="w-4 h-4 text-gray-400 hover:text-white" />
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {agents.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">No agents. Create one first.</p>
              )}
              {agents.map(a => (
                <button key={a.id} onClick={() => addAgentNode(a)}
                  className="w-full text-left px-4 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors">
                  <div className="font-medium text-white text-sm">{a.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {a.role} · {a.model} · {a.tools.length} tool{a.tools.length !== 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edge Condition Modal */}
      {showEdgeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-96 p-5">
            <h3 className="font-medium text-white mb-3">Edge Condition</h3>
            <p className="text-xs text-gray-400 mb-3">
              Leave empty for unconditional routing.<br />
              Examples: <code className="text-brand-400">contains:DONE</code> ·{' '}
              <code className="text-brand-400">ends_with:ESCALATE</code> ·{' '}
              <code className="text-brand-400">python:len(state['messages'])&gt;5</code>
            </p>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 font-mono mb-4"
              placeholder="e.g. contains:DONE"
              value={edgeCondition}
              onChange={e => setEdgeCondition(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEdgeModal(null)}
                className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">
                Cancel
              </button>
              <button onClick={saveEdgeCondition}
                className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFlowNodes(workflow: Workflow, agents: Agent[]) {
  const agentMap = Object.fromEntries(agents.map(a => [a.id, a]))
  return (workflow.nodes || []).map(n => ({
    id: n.id,
    type: 'agentNode',
    position: n.position,
    data: {
      label: agentMap[n.agent_id]?.name || n.data?.label || 'Unknown',
      agent_id: n.agent_id,
      role: agentMap[n.agent_id]?.role || 'assistant',
      tools: agentMap[n.agent_id]?.tools || [],
      memory_enabled: agentMap[n.agent_id]?.memory_enabled ?? true,
    },
  }))
}

function toFlowEdges(workflow: Workflow) {
  return (workflow.edges || []).map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    label: e.condition || undefined,
    data: { condition: e.condition, label: e.label },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#4f6ef7' },
    style: { stroke: e.condition ? '#f59e0b' : '#4f6ef7' },
  }))
}
