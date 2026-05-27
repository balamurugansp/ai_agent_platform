import { useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle, XCircle, Loader, MessageSquare, Wrench, Zap } from 'lucide-react'
import { wsUrl } from '../../api/client'
import { useStore } from '../../store/useStore'
import type { WsEvent, WorkflowRun } from '../../types'
import { runsApi } from '../../api/runs'

const EVENT_ICON: Record<string, React.ReactNode> = {
  agent_started: <Zap className="w-3.5 h-3.5 text-yellow-400" />,
  agent_message: <MessageSquare className="w-3.5 h-3.5 text-blue-400" />,
  agent_error:   <XCircle className="w-3.5 h-3.5 text-red-400" />,
  run_started:   <Loader className="w-3.5 h-3.5 text-brand-400 animate-spin" />,
  run_completed: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  run_failed:    <XCircle className="w-3.5 h-3.5 text-red-400" />,
  tool_call:     <Wrench className="w-3.5 h-3.5 text-purple-400" />,
  ping:          <Activity className="w-3.5 h-3.5 text-gray-600" />,
}

interface Props {
  runId?: string  // subscribe to a specific run; omit for global
}

export default function MonitorPanel({ runId = '__global__' }: Props) {
  const { liveEvents, addLiveEvent, clearLiveEvents } = useStore()
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // WebSocket connection
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(wsUrl(runId))
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        // Reconnect after 3s
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (evt) => {
        try {
          const event: WsEvent = JSON.parse(evt.data)
          if (event.type !== 'ping') {
            addLiveEvent(event)
          }
        } catch {}
      }
    }
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [runId])

  // Load run history
  useEffect(() => {
    runsApi.list().then(setRuns).catch(() => {})
    const interval = setInterval(() => {
      runsApi.list().then(setRuns).catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [liveEvents])

  const loadRun = async (run: WorkflowRun) => {
    try {
      const full = await runsApi.get(run.id)
      setSelectedRun(full)
    } catch {}
  }

  const statusBadge = (status: string) => {
    const cls: Record<string, string> = {
      completed: 'bg-green-900/50 text-green-400',
      running:   'bg-blue-900/50 text-blue-400',
      failed:    'bg-red-900/50 text-red-400',
      pending:   'bg-gray-800 text-gray-400',
    }
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls[status] || cls.pending}`}>
        {status}
      </span>
    )
  }

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Left: Run History */}
      <div className="w-64 shrink-0 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">Run History</span>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-gray-600'}`} title={connected ? 'Live' : 'Disconnected'} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {runs.length === 0 && (
            <p className="text-gray-600 text-xs text-center py-8">No runs yet</p>
          )}
          {runs.map(run => (
            <button key={run.id} onClick={() => loadRun(run)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800 transition-colors ${selectedRun?.id === run.id ? 'bg-gray-800' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                {statusBadge(run.status)}
                <span className="text-[10px] text-gray-600">
                  {new Date(run.started_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-xs text-gray-400 truncate">{run.input_message}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">
                {run.tokens_used} tok · ${run.estimated_cost.toFixed(4)} · {run.trigger_source}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Middle: Live Event Log */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-800">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">Live Events</span>
          <button onClick={clearLiveEvents} className="text-[11px] text-gray-600 hover:text-gray-400">
            Clear
          </button>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5">
          {liveEvents.length === 0 && (
            <p className="text-gray-700 text-center py-8 font-sans text-xs">
              Waiting for events…<br />
              <span className="text-gray-800">Run a workflow to see live logs</span>
            </p>
          )}
          {[...liveEvents].reverse().map((evt, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-800/50">
              <span className="mt-0.5 shrink-0">{EVENT_ICON[evt.type] || <Activity className="w-3.5 h-3.5 text-gray-600" />}</span>
              <div className="flex-1 min-w-0">
                <span className="text-gray-500">{evt.timestamp?.slice(11, 19)} </span>
                <span className="text-brand-400">[{evt.type}] </span>
                {!!evt.data.agent_name && (
                  <span className="text-yellow-400">{String(evt.data.agent_name)}: </span>
                )}
                {!!evt.data.content && (
                  <span className="text-gray-300 break-all">
                    {String(evt.data.content).slice(0, 200)}
                    {String(evt.data.content).length > 200 ? '…' : ''}
                  </span>
                )}
                {!!evt.data.error && (
                  <span className="text-red-400">{String(evt.data.error)}</span>
                )}
                {!!evt.data.output && !evt.data.content && (
                  <span className="text-green-400">
                    {String(evt.data.output).slice(0, 200)}
                    {String(evt.data.output).length > 200 ? '…' : ''}
                  </span>
                )}
              </div>
              {!!evt.data.tokens && (
                <span className="text-gray-700 shrink-0">{String(evt.data.tokens)}tok</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Selected Run Detail */}
      <div className="w-80 shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <span className="text-sm font-medium text-gray-300">
            {selectedRun ? `Run ${selectedRun.id.slice(0, 8)}…` : 'Select a run'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!selectedRun && (
            <p className="text-gray-600 text-xs text-center py-8">Click a run from the history</p>
          )}
          {selectedRun && (
            <>
              <div className="bg-gray-800 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  {statusBadge(selectedRun.status)}
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tokens</span>
                  <span className="text-gray-300">{selectedRun.tokens_used}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cost</span>
                  <span className="text-gray-300">${selectedRun.estimated_cost.toFixed(5)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Trigger</span>
                  <span className="text-gray-300">{selectedRun.trigger_source}</span>
                </div>
              </div>

              <div className="space-y-2">
                {selectedRun.messages.map(msg => (
                  <div key={msg.id} className={`rounded-lg p-2.5 text-xs ${
                    msg.role === 'user' ? 'bg-gray-800 border-l-2 border-gray-600' :
                    msg.role === 'assistant' ? 'bg-gray-900 border-l-2 border-brand-500' :
                    'bg-gray-900 border-l-2 border-yellow-600'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-medium text-gray-400">{msg.agent_name || 'System'}</span>
                      <span className="text-gray-600">·</span>
                      <span className="text-gray-600 capitalize">{msg.role}</span>
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                ))}
              </div>

              {selectedRun.output_message && (
                <div className="bg-green-950 border border-green-800 rounded-lg p-3">
                  <div className="text-xs font-medium text-green-400 mb-1">Final Output</div>
                  <p className="text-xs text-green-200 whitespace-pre-wrap">{selectedRun.output_message}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
