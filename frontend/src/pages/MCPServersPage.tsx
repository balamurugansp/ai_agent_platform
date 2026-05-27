import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  getMCPServers, createMCPServer, deleteMCPServer,
  connectMCPServer, disconnectMCPServer, callMCPTool,
  MCPServer,
} from '../api/mcp'
import {
  Plus, Plug, PlugZap, Trash2, RefreshCw, ChevronDown,
  ChevronRight, Terminal, Globe, Zap, Play, AlertCircle, CheckCircle2,
} from 'lucide-react'

const TRANSPORT_ICONS: Record<string, any> = {
  stdio: Terminal, sse: Globe, websocket: Zap,
}
const STATUS_COLORS: Record<string, string> = {
  connected: 'text-green-400', disconnected: 'text-gray-400', error: 'text-red-400',
}

const BLANK: Partial<MCPServer> = {
  name: '', description: '', transport: 'stdio', url: '', command: '', args: [], env: {}, is_active: true,
}

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Partial<MCPServer>>(BLANK)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toolTester, setToolTester] = useState<{ serverId: string; toolName: string; args: string } | null>(null)
  const [toolResult, setToolResult] = useState<string>('')

  const load = useCallback(async () => {
    try { setServers(await getMCPServers()) }
    catch { toast.error('Failed to load MCP servers') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name required')
    try {
      const created = await createMCPServer(form)
      setServers(prev => [created, ...prev])
      setShowAdd(false); setForm(BLANK)
      toast.success('MCP server added')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleConnect = async (id: string) => {
    const tid = toast.loading('Connecting…')
    try {
      const res = await connectMCPServer(id)
      await load()
      toast.success(`Connected — ${res.capabilities?.tools?.length ?? 0} tools discovered`, { id: tid })
    } catch (e: any) { toast.error(`Connect failed: ${e.response?.data?.detail ?? e.message}`, { id: tid }) }
  }

  const handleDisconnect = async (id: string) => {
    await disconnectMCPServer(id); await load(); toast.success('Disconnected')
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this MCP server?')) return
    await deleteMCPServer(id)
    setServers(prev => prev.filter(s => s.id !== id))
    toast.success('Deleted')
  }

  const handleCallTool = async () => {
    if (!toolTester) return
    try {
      const args = JSON.parse(toolTester.args || '{}')
      const res = await callMCPTool(toolTester.serverId, toolTester.toolName, args)
      setToolResult(JSON.stringify(res, null, 2))
    } catch (e: any) { setToolResult(`Error: ${e.message}`) }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading MCP servers…</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">MCP Servers</h1>
          <p className="text-gray-400 text-sm mt-1">
            Connect to Model Context Protocol servers to give agents dynamic tools, prompts, and resources.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Add Server
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total', value: servers.length },
          { label: 'Connected', value: servers.filter(s => s.status === 'connected').length, color: 'text-green-400' },
          { label: 'Errors', value: servers.filter(s => s.status === 'error').length, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
            <div className="text-gray-400 text-sm">{label}</div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
          <h2 className="text-white font-semibold mb-4">New MCP Server</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-400 text-xs">Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600" />
            </div>
            <div>
              <label className="text-gray-400 text-xs">Transport</label>
              <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value as any })}
                className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600">
                <option value="stdio">stdio (local process)</option>
                <option value="sse">SSE (HTTP remote)</option>
                <option value="websocket">WebSocket (remote)</option>
              </select>
            </div>
            {form.transport === 'stdio' ? (
              <>
                <div>
                  <label className="text-gray-400 text-xs">Command</label>
                  <input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })}
                    placeholder="e.g. npx" className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs">Args (space-separated)</label>
                  <input
                    value={(form.args || []).join(' ')}
                    onChange={e => setForm({ ...form, args: e.target.value.split(' ').filter(Boolean) })}
                    placeholder="e.g. -y @modelcontextprotocol/server-filesystem"
                    className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600" />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="text-gray-400 text-xs">URL</label>
                <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                  placeholder="https://mcp.example.com or ws://localhost:3001"
                  className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600" />
              </div>
            )}
            <div className="col-span-2">
              <label className="text-gray-400 text-xs">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full mt-1 bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreate} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">
              Add Server
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Server list */}
      <div className="space-y-3">
        {servers.length === 0 && (
          <div className="text-gray-500 text-center py-12 bg-gray-800 rounded-xl border border-gray-700">
            No MCP servers configured. Add one to give agents dynamic tools.
          </div>
        )}
        {servers.map(server => {
          const Icon = TRANSPORT_ICONS[server.transport] || Terminal
          const isExpanded = expanded === server.id
          const tools = server.capabilities?.tools || []
          const prompts = server.capabilities?.prompts || []
          const resources = server.capabilities?.resources || []
          return (
            <div key={server.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="w-9 h-9 bg-gray-700 rounded-lg flex items-center justify-center">
                  <Icon size={18} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">{server.name}</span>
                    <span className={`text-xs font-mono ${STATUS_COLORS[server.status] || 'text-gray-400'}`}>
                      ● {server.status}
                    </span>
                  </div>
                  <div className="text-gray-400 text-xs mt-0.5 flex items-center gap-2">
                    <span className="bg-gray-700 px-1.5 py-0.5 rounded">{server.transport}</span>
                    {server.command && <span className="truncate font-mono">{server.command} {(server.args || []).join(' ')}</span>}
                    {server.url && <span className="truncate">{server.url}</span>}
                  </div>
                  {server.error_message && (
                    <div className="text-red-400 text-xs mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {server.error_message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tools.length > 0 && (
                    <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800">
                      {tools.length} tools
                    </span>
                  )}
                  {server.status === 'connected' ? (
                    <button onClick={() => handleDisconnect(server.id)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2.5 py-1 rounded flex items-center gap-1">
                      <PlugZap size={13} /> Disconnect
                    </button>
                  ) : (
                    <button onClick={() => handleConnect(server.id)}
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2.5 py-1 rounded flex items-center gap-1">
                      <Plug size={13} /> Connect
                    </button>
                  )}
                  <button onClick={() => setExpanded(isExpanded ? null : server.id)}
                    className="text-gray-400 hover:text-white p-1">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <button onClick={() => handleDelete(server.id)}
                    className="text-red-400 hover:text-red-300 p-1">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-700 p-4 space-y-4">
                  {/* Tools */}
                  {tools.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">
                        Tools ({tools.length})
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {tools.map(tool => (
                          <div key={tool.name}
                            className="bg-gray-700/50 rounded-lg p-3 border border-gray-600 cursor-pointer hover:border-blue-500"
                            onClick={() => setToolTester({ serverId: server.id, toolName: tool.name, args: '{}' })}>
                            <div className="text-white text-sm font-mono">{tool.name}</div>
                            <div className="text-gray-400 text-xs mt-1 line-clamp-2">{tool.description}</div>
                            <div className="text-blue-400 text-xs mt-1.5 flex items-center gap-1">
                              <Play size={10} /> Test tool
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Prompts */}
                  {prompts.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">Prompts ({prompts.length})</h3>
                      <div className="flex flex-wrap gap-2">
                        {prompts.map(p => (
                          <span key={p.name} className="bg-purple-900/30 text-purple-300 text-xs px-2 py-0.5 rounded border border-purple-700">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Resources */}
                  {resources.length > 0 && (
                    <div>
                      <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">Resources ({resources.length})</h3>
                      <div className="space-y-1">
                        {resources.map(r => (
                          <div key={r.name} className="flex items-center gap-2 text-xs text-gray-300">
                            <span className="text-gray-500 font-mono">{r.uri}</span>
                            <span className="text-gray-500">{r.mimeType}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {tools.length === 0 && prompts.length === 0 && resources.length === 0 && (
                    <div className="text-gray-500 text-sm">
                      {server.status === 'connected'
                        ? 'No capabilities discovered.'
                        : 'Connect to discover capabilities.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Tool tester modal */}
      {toolTester && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg">
            <div className="p-5">
              <h3 className="text-white font-semibold mb-1">Test Tool: <span className="font-mono text-blue-400">{toolTester.toolName}</span></h3>
              <label className="text-gray-400 text-xs">Arguments (JSON)</label>
              <textarea
                value={toolTester.args}
                onChange={e => setToolTester({ ...toolTester, args: e.target.value })}
                rows={4}
                className="w-full mt-1 bg-gray-700 text-white font-mono text-sm rounded px-3 py-2 border border-gray-600"
              />
              {toolResult && (
                <div>
                  <label className="text-gray-400 text-xs mt-3 block">Result</label>
                  <pre className="bg-gray-900 text-green-400 text-xs font-mono p-3 rounded mt-1 overflow-auto max-h-48">{toolResult}</pre>
                </div>
              )}
            </div>
            <div className="border-t border-gray-700 p-4 flex gap-3">
              <button onClick={handleCallTool}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2">
                <Play size={14} /> Run
              </button>
              <button onClick={() => { setToolTester(null); setToolResult('') }}
                className="text-gray-400 hover:text-white px-4 py-2 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
