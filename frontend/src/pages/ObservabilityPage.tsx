import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, CheckCircle, XCircle, Loader, MessageSquare, Wrench, Zap, RefreshCw, Trash2 } from 'lucide-react'
import { wsUrl } from '../api/client'
import { runsApi } from '../api/runs'
import { getMCPServers, getDLQ, clearDLQ, getCheckpoints } from '../api/mcp'
import { useStore } from '../store/useStore'
import type { WsEvent, WorkflowRun } from '../types'
import type { MCPServer, HITLCheckpoint } from '../api/mcp'

// ─── Types ───────────────────────────────────────────
interface A2AMessage {
  id: string
  run_id: string
  source_agent_id: string
  source_agent_name?: string
  target_agent_id: string
  target_agent_name?: string
  payload: Record<string, any>
  attempt: number
  created_at: string
}

interface TokenStat {
  agent: string
  total_tokens: number
  total_cost: number
  runs: number
}

// ─── Helpers ─────────────────────────────────────────
const EVENT_ICON: Record<string, React.ReactNode> = {
  agent_started:  <Zap className="w-3.5 h-3.5 text-yellow-400" />,
  agent_message:  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />,
  agent_error:    <XCircle className="w-3.5 h-3.5 text-red-400" />,
  run_started:    <Loader className="w-3.5 h-3.5 text-brand-400 animate-spin" />,
  run_completed:  <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  run_failed:     <XCircle className="w-3.5 h-3.5 text-red-400" />,
  tool_call:      <Wrench className="w-3.5 h-3.5 text-purple-400" />,
  a2a_message:    <Activity className="w-3.5 h-3.5 text-cyan-400" />,
}

function fmtCost(n: number) { return `$${n.toFixed(5)}` }
function fmtNum(n: number) { return n.toLocaleString() }
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  return `${Math.floor(diff / 3600000)}h`
}

// Mini bar chart (pure SVG, no deps)
function MiniBar({ values, max, color }: { values: number[]; max: number; color: string }) {
  const h = 32, w = 100, gap = 2
  const bw = values.length ? (w - gap * (values.length - 1)) / values.length : 6
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {values.map((v, i) => {
        const barH = max > 0 ? (v / max) * h : 0
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={h - barH}
            width={bw}
            height={barH}
            rx={1}
            fill={color}
            opacity={0.8}
          />
        )
      })}
    </svg>
  )
}

// ─── Sub-panels ──────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-1 border border-gray-700">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

function LiveEventLog({ events, onClear, connected }: {
  events: WsEvent[]; onClear: () => void; connected: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events])

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="text-sm font-medium text-gray-300">Live Event Stream</span>
        </div>
        <button onClick={onClear} className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5">
        {events.length === 0 && (
          <p className="text-gray-700 text-center py-8 font-sans text-xs">Waiting for events…</p>
        )}
        {[...events].reverse().map((evt, i) => (
          <div key={i} className="flex items-start gap-2 px-2 py-0.5 rounded hover:bg-gray-800/50">
            <span className="mt-0.5 shrink-0">{EVENT_ICON[evt.type] || <Activity className="w-3.5 h-3.5 text-gray-600" />}</span>
            <span className="text-gray-600">{evt.timestamp?.slice(11, 19)} </span>
            <span className="text-brand-400">[{evt.type}]</span>
            {!!evt.data.agent_name && <span className="text-yellow-400">{String(evt.data.agent_name)}:</span>}
            {!!evt.data.content && (
              <span className="text-gray-300 break-all">
                {String(evt.data.content).slice(0, 160)}
                {String(evt.data.content).length > 160 ? '…' : ''}
              </span>
            )}
            {!!evt.data.error && <span className="text-red-400">{String(evt.data.error)}</span>}
            {!!evt.data.tokens && <span className="text-gray-700 ml-auto shrink-0">{String(evt.data.tokens)}tok</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function A2AMessageLog({ messages }: { messages: A2AMessage[] }) {
  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-medium text-gray-300">A2A Message Bus</span>
        <span className="ml-auto text-xs text-gray-500">{messages.length} messages</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {messages.length === 0 && (
          <p className="text-gray-700 text-xs text-center py-8">No inter-agent messages yet</p>
        )}
        {[...messages].reverse().map(msg => (
          <div key={msg.id} className="bg-gray-800 rounded-lg px-3 py-2 text-xs border border-gray-700">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-cyan-400">{msg.source_agent_name || msg.source_agent_id.slice(0, 8)}</span>
              <span className="text-gray-500">→</span>
              <span className="font-mono text-blue-400">{msg.target_agent_name || msg.target_agent_id.slice(0, 8)}</span>
              <span className="ml-auto text-gray-600">{timeAgo(msg.created_at)} ago</span>
              {msg.attempt > 1 && (
                <span className="px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded-full text-[10px]">
                  retry #{msg.attempt}
                </span>
              )}
            </div>
            <p className="text-gray-400 font-mono truncate">
              {JSON.stringify(msg.payload).slice(0, 100)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function MCPConnectionPanel({ servers }: { servers: MCPServer[] }) {
  const connected = servers.filter(s => s.status === 'connected')
  const errored = servers.filter(s => s.status === 'error')

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-300">MCP Connections</span>
        <span className="ml-auto text-xs text-gray-500">
          {connected.length}/{servers.length} active
        </span>
      </div>
      <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
        {servers.length === 0 && (
          <p className="text-gray-600 text-xs text-center py-4">No MCP servers configured</p>
        )}
        {servers.map(srv => (
          <div key={srv.id} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 text-xs">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              srv.status === 'connected' ? 'bg-green-400' :
              srv.status === 'error' ? 'bg-red-400' : 'bg-gray-500'
            }`} />
            <span className="text-gray-200 font-medium flex-1 truncate">{srv.name}</span>
            <span className="text-gray-500 uppercase tracking-wide">{srv.transport}</span>
            <span className="text-gray-600">
              {srv.capabilities?.tools?.length ?? 0}T
            </span>
          </div>
        ))}
        {errored.length > 0 && (
          <div className="mt-2 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-300">
            {errored.length} server{errored.length > 1 ? 's' : ''} in error state
          </div>
        )}
      </div>
    </div>
  )
}

function DLQPanel({ dlq, onClear }: { dlq: any[]; onClear: () => void }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
        <XCircle className="w-4 h-4 text-red-400" />
        <span className="text-sm font-medium text-gray-300">Dead-Letter Queue</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          dlq.length > 0 ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-600'
        }`}>
          {dlq.length}
        </span>
        {dlq.length > 0 && (
          <button onClick={onClear} className="text-xs text-gray-600 hover:text-red-400">
            Clear
          </button>
        )}
      </div>
      <div className="p-3 max-h-48 overflow-y-auto">
        {dlq.length === 0 ? (
          <p className="text-gray-700 text-xs text-center py-4">Queue is empty ✓</p>
        ) : (
          <div className="space-y-1.5">
            {dlq.slice(-10).reverse().map((item: any, i) => (
              <div key={i} className="bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-red-400">{item.id?.slice(0, 12)}…</span>
                  <span className="text-gray-600">{item.attempt} attempts</span>
                </div>
                <p className="text-gray-500 truncate font-mono">{item.error || JSON.stringify(item).slice(0, 80)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TokenTable({ stats }: { stats: TokenStat[] }) {
  const maxTok = Math.max(...stats.map(s => s.total_tokens), 1)
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">Token Consumption by Agent</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="px-4 py-2 text-left font-medium">Agent</th>
              <th className="px-4 py-2 text-right font-medium">Tokens</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">Runs</th>
              <th className="px-4 py-2 text-left font-medium w-28">Usage</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-600">
                  No data yet. Run some workflows to see stats.
                </td>
              </tr>
            ) : (
              stats.map((s, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-gray-300 font-medium">{s.agent}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{fmtNum(s.total_tokens)}</td>
                  <td className="px-4 py-2 text-right text-green-400">{fmtCost(s.total_cost)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{s.runs}</td>
                  <td className="px-4 py-2">
                    <div className="bg-gray-800 rounded-full h-1.5 w-full">
                      <div
                        className="bg-brand-500 h-1.5 rounded-full"
                        style={{ width: `${(s.total_tokens / maxTok) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RecentRunsTable({ runs }: { runs: WorkflowRun[] }) {
  const statusColor: Record<string, string> = {
    completed: 'text-green-400 bg-green-900/40',
    running:   'text-blue-400 bg-blue-900/40',
    failed:    'text-red-400 bg-red-900/40',
    pending:   'text-gray-400 bg-gray-800',
  }
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">Recent Runs</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="px-4 py-2 text-left font-medium">Run ID</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Input</th>
              <th className="px-4 py-2 text-right font-medium">Tokens</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-600">No runs yet</td>
              </tr>
            ) : (
              runs.slice(0, 20).map(run => (
                <tr key={run.id} className="border-b border-gray-800/50 hover:bg-gray-800/50">
                  <td className="px-4 py-2 font-mono text-gray-500">{run.id.slice(0, 8)}…</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor[run.status] || statusColor.pending}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400 max-w-[180px] truncate">{run.input_message}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{fmtNum(run.tokens_used)}</td>
                  <td className="px-4 py-2 text-right text-green-400">{fmtCost(run.estimated_cost)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{run.trigger_source}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{timeAgo(run.started_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HITLSummary({ checkpoints }: { checkpoints: HITLCheckpoint[] }) {
  const pending = checkpoints.filter(c => c.status === 'pending')
  const approved = checkpoints.filter(c => c.status === 'approved')
  const rejected = checkpoints.filter(c => c.status === 'rejected')

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-300">HITL Status</span>
        {pending.length > 0 && (
          <span className="px-2 py-0.5 text-xs bg-amber-900/50 text-amber-400 rounded-full animate-pulse">
            {pending.length} pending
          </span>
        )}
      </div>
      <div className="p-3 grid grid-cols-3 gap-2">
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-amber-400">{pending.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Pending</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-green-400">{approved.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Approved</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-red-400">{rejected.length}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Rejected</p>
        </div>
      </div>
      <div className="px-3 pb-3 space-y-1 max-h-32 overflow-y-auto">
        {pending.map(cp => (
          <div key={cp.id} className="flex items-center gap-2 bg-amber-900/20 border border-amber-800/30 rounded px-2 py-1 text-xs">
            <span className="text-amber-400">⏳</span>
            <span className="text-gray-300 flex-1 truncate">{cp.agent_name}</span>
            <span className="text-gray-500">{timeAgo(cp.created_at)} ago</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────
export default function ObservabilityPage() {
  const { liveEvents, addLiveEvent, clearLiveEvents } = useStore()
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [a2aMessages, setA2aMessages] = useState<A2AMessage[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [dlqItems, setDlqItems] = useState<any[]>([])
  const [checkpoints, setCheckpoints] = useState<HITLCheckpoint[]>([])
  const [connected, setConnected] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // Derive token stats from runs
  const tokenStats: TokenStat[] = React.useMemo(() => {
    const map = new Map<string, TokenStat>()
    for (const run of runs) {
      for (const msg of run.messages || []) {
        if (!msg.agent_name || msg.role !== 'assistant') continue
        const existing = map.get(msg.agent_name) || {
          agent: msg.agent_name,
          total_tokens: 0,
          total_cost: 0,
          runs: 0,
        }
        existing.total_tokens += (msg as any).tokens || 0
        existing.total_cost += (msg as any).cost || 0
        existing.runs += 1
        map.set(msg.agent_name, existing)
      }
    }
    return [...map.values()].sort((a, b) => b.total_tokens - a.total_tokens)
  }, [runs])

  const totalTokens = runs.reduce((s, r) => s + r.tokens_used, 0)
  const totalCost = runs.reduce((s, r) => s + r.estimated_cost, 0)
  const activeRuns = runs.filter(r => r.status === 'running').length
  const connectedMcp = mcpServers.filter(s => s.status === 'connected').length
  const pendingHitl = checkpoints.filter(c => c.status === 'pending').length

  const loadAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const [r, mcp, dlq, cp] = await Promise.all([
        runsApi.list().catch(() => [] as WorkflowRun[]),
        getMCPServers().catch(() => [] as MCPServer[]),
        getDLQ().catch(() => ({ messages: [] })),
        getCheckpoints().catch(() => [] as HITLCheckpoint[]),
      ])
      setRuns(r)
      setMcpServers(mcp)
      setDlqItems(Array.isArray(dlq) ? dlq : dlq.messages || [])
      setCheckpoints(cp)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, 15000)
    return () => clearInterval(t)
  }, [loadAll])

  // WebSocket for live events
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(wsUrl('__global__'))
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (evt) => {
        try {
          const event: WsEvent = JSON.parse(evt.data)
          if (event.type === 'ping') return
          addLiveEvent(event)
          if (event.type === 'a2a_message') {
            setA2aMessages(prev => [...prev.slice(-199), event.data as unknown as A2AMessage])
          }
        } catch {}
      }
    }
    connect()
    return () => wsRef.current?.close()
  }, [addLiveEvent])

  const handleClearDLQ = async () => {
    await clearDLQ().catch(() => {})
    setDlqItems([])
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Observability Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">Real-time inter-agent telemetry, cost tracking, and system health</p>
        </div>
        <button
          onClick={loadAll}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Total Runs" value={runs.length} sub={`${activeRuns} active`} color="text-brand-400" />
          <KpiCard label="Total Tokens" value={fmtNum(totalTokens)} sub="all runs" color="text-blue-400" />
          <KpiCard label="Total Cost" value={fmtCost(totalCost)} sub="estimated" color="text-green-400" />
          <KpiCard label="MCP Connected" value={`${connectedMcp}/${mcpServers.length}`} sub="servers" color="text-purple-400" />
          <KpiCard
            label="HITL Pending"
            value={pendingHitl}
            sub={pendingHitl > 0 ? 'workflows paused' : 'all clear'}
            color={pendingHitl > 0 ? 'text-amber-400' : 'text-gray-400'}
          />
        </div>

        {/* Middle row: Live events + A2A messages */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: 320 }}>
          <LiveEventLog events={liveEvents} onClear={clearLiveEvents} connected={connected} />
          <A2AMessageLog messages={a2aMessages} />
        </div>

        {/* Side-by-side: MCP + DLQ + HITL */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MCPConnectionPanel servers={mcpServers} />
          <DLQPanel dlq={dlqItems} onClear={handleClearDLQ} />
          <HITLSummary checkpoints={checkpoints} />
        </div>

        {/* Token stats table */}
        <TokenTable stats={tokenStats} />

        {/* Recent runs table */}
        <RecentRunsTable runs={runs} />

      </div>
    </div>
  )
}
