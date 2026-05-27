import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import type { Agent, AvailableTool } from '../../types'
import { agentsApi } from '../../api/agents'
import { getMCPServers, MCPServer } from '../../api/mcp'

interface Props {
  agent?: Agent | null
  onSave: (agent: Agent) => void
  onClose: () => void
}

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const ROLES = ['assistant', 'orchestrator', 'researcher', 'writer', 'classifier', 'support', 'escalation', 'custom']

type Section = 'basic' | 'memory' | 'mcp' | 'hitl' | 'guardrails' | 'channels'

function SectionHeader({
  title, icon, open, onToggle, badge,
}: { title: string; icon: string; open: boolean; onToggle: () => void; badge?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors text-left"
    >
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        {badge && (
          <span className="px-2 py-0.5 text-xs bg-brand-600 text-white rounded-full">{badge}</span>
        )}
      </div>
      {open ? (
        <ChevronUp className="w-4 h-4 text-gray-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-gray-400" />
      )}
    </button>
  )
}

export default function AgentForm({ agent, onSave, onClose }: Props) {
  const [tools, setTools] = useState<AvailableTool[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [openSections, setOpenSections] = useState<Record<Section, boolean>>({
    basic: true, memory: true, mcp: false, hitl: false, guardrails: false, channels: false,
  })

  const [form, setForm] = useState({
    // Basic
    name: agent?.name ?? '',
    role: agent?.role ?? 'assistant',
    system_prompt: agent?.system_prompt ?? 'You are a helpful assistant.',
    model: agent?.model ?? 'gpt-4o-mini',
    temperature: agent?.temperature ?? 0.7,
    max_tokens: agent?.max_tokens ?? 2048,
    tools: agent?.tools ?? [] as string[],
    // Memory (new advanced fields)
    memory_enabled: agent?.memory_enabled ?? true,
    memory_window: agent?.memory_window ?? 10,
    memory_type: (agent as any)?.memory_type ?? 'sliding_window',
    memory_token_limit: (agent as any)?.memory_token_limit ?? 4000,
    // MCP bindings (new)
    mcp_server_ids: (agent as any)?.mcp_server_ids ?? [] as string[],
    mcp_tool_whitelist: (agent as any)?.mcp_tool_whitelist ?? [] as string[],
    // HITL (new)
    hitl_enabled: (agent as any)?.hitl_enabled ?? false,
    hitl_every_n_turns: (agent as any)?.hitl_every_n_turns ?? 5,
    hitl_timeout_seconds: (agent as any)?.hitl_timeout_seconds ?? 300,
    // A2A guardrails (new)
    max_turns: (agent as any)?.max_turns ?? 20,
    loop_detection_threshold: (agent as any)?.loop_detection_threshold ?? 0.95,
    // Legacy
    schedule: agent?.schedule ?? '',
    skills: agent?.skills ?? [] as string[],
    channels: agent?.channels ?? [] as { channel: string; [k: string]: string }[],
    guardrails: {
      max_calls_per_minute: (agent?.guardrails as any)?.max_calls_per_minute ?? 10,
      forbidden_topics: ((agent?.guardrails as any)?.forbidden_topics ?? []).join(', '),
    },
  })

  const [newSkill, setNewSkill] = useState('')
  const [newWhitelistTool, setNewWhitelistTool] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    agentsApi.tools().then(setTools).catch(() => {})
    getMCPServers().then(setMcpServers).catch(() => {})
  }, [])

  const toggleSection = (s: Section) =>
    setOpenSections(prev => ({ ...prev, [s]: !prev[s] }))

  const toggleTool = (tool: string) => {
    setForm(f => ({
      ...f,
      tools: f.tools.includes(tool) ? f.tools.filter(t => t !== tool) : [...f.tools, tool],
    }))
  }

  const toggleMcpServer = (id: string) => {
    setForm(f => ({
      ...f,
      mcp_server_ids: f.mcp_server_ids.includes(id)
        ? f.mcp_server_ids.filter((s: string) => s !== id)
        : [...f.mcp_server_ids, id],
    }))
  }

  const addWhitelistTool = () => {
    const t = newWhitelistTool.trim()
    if (t && !form.mcp_tool_whitelist.includes(t)) {
      setForm(f => ({ ...f, mcp_tool_whitelist: [...f.mcp_tool_whitelist, t] }))
      setNewWhitelistTool('')
    }
  }

  const removeWhitelistTool = (t: string) =>
    setForm(f => ({ ...f, mcp_tool_whitelist: f.mcp_tool_whitelist.filter((x: string) => x !== t) }))

  const addChannel = () =>
    setForm(f => ({ ...f, channels: [...f.channels, { channel: 'telegram' as const }] }))
  const removeChannel = (i: number) =>
    setForm(f => ({ ...f, channels: f.channels.filter((_ch: typeof f.channels[0], idx: number) => idx !== i) }))

  const addSkill = () => {
    if (newSkill.trim()) {
      setForm(f => ({ ...f, skills: [...f.skills, newSkill.trim()] }))
      setNewSkill('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        schedule: form.schedule || null,
        guardrails: {
          max_calls_per_minute: form.guardrails.max_calls_per_minute,
          forbidden_topics: form.guardrails.forbidden_topics
            ? form.guardrails.forbidden_topics.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [],
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saved = agent
        ? await agentsApi.update(agent.id, payload as any)
        : await agentsApi.create(payload as any)
      toast.success(agent ? 'Agent updated!' : 'Agent created!')
      onSave(saved)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Compute badge text for sections
  const mcpBadge = form.mcp_server_ids.length > 0
    ? `${form.mcp_server_ids.length} server${form.mcp_server_ids.length > 1 ? 's' : ''}`
    : undefined
  const hitlBadge = form.hitl_enabled ? 'ON' : undefined

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <h2 className="font-semibold text-white text-lg">
            {agent ? `Edit Agent: ${agent.name}` : 'Create New Agent'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* ── BASIC SECTION ── */}
          <SectionHeader title="Basic Configuration" icon="⚙️" open={openSections.basic} onToggle={() => toggleSection('basic')} />
          {openSections.basic && (
            <div className="space-y-4 pl-1">
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="label">Name *</span>
                  <input className="input" required value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="label">Role</span>
                  <select className="input" value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="label">System Prompt</span>
                <textarea className="input min-h-24 resize-y" value={form.system_prompt}
                  onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))} />
              </label>

              <div className="grid grid-cols-3 gap-4">
                <label className="block">
                  <span className="label">Model</span>
                  <select className="input" value={form.model}
                    onChange={e => setForm(f => ({ ...f, model: e.target.value }))}>
                    {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Temperature ({form.temperature})</span>
                  <input type="range" min="0" max="2" step="0.1" className="w-full mt-2"
                    value={form.temperature}
                    onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))} />
                </label>
                <label className="block">
                  <span className="label">Max Tokens</span>
                  <input type="number" className="input" value={form.max_tokens}
                    onChange={e => setForm(f => ({ ...f, max_tokens: parseInt(e.target.value) }))} />
                </label>
              </div>

              {/* Built-in Tools */}
              <div>
                <span className="label block mb-2">Built-in Tools</span>
                <div className="flex flex-wrap gap-2">
                  {tools.map(t => (
                    <button key={t.name} type="button" onClick={() => toggleTool(t.name)} title={t.description}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        form.tools.includes(t.name)
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'border-gray-600 text-gray-400 hover:border-gray-400'
                      }`}>
                      {t.name}
                    </button>
                  ))}
                  {tools.length === 0 && (
                    <span className="text-xs text-gray-500 italic">No built-in tools registered</span>
                  )}
                </div>
              </div>

              {/* A2A guardrails */}
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="label">Max Turns (A2A)</span>
                  <input type="number" min={1} className="input" value={form.max_turns}
                    onChange={e => setForm(f => ({ ...f, max_turns: parseInt(e.target.value) }))} />
                  <p className="text-xs text-gray-500 mt-1">Stop after this many turns between agents</p>
                </label>
                <label className="block">
                  <span className="label">Loop Detection Threshold</span>
                  <input type="number" step="0.01" min="0.5" max="1.0" className="input"
                    value={form.loop_detection_threshold}
                    onChange={e => setForm(f => ({ ...f, loop_detection_threshold: parseFloat(e.target.value) }))} />
                  <p className="text-xs text-gray-500 mt-1">Similarity threshold (0–1) for repetition detection</p>
                </label>
              </div>
            </div>
          )}

          {/* ── MEMORY SECTION ── */}
          <SectionHeader title="Memory & Context" icon="🧠" open={openSections.memory} onToggle={() => toggleSection('memory')} />
          {openSections.memory && (
            <div className="space-y-4 pl-1">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="memEnabled" checked={form.memory_enabled}
                  onChange={e => setForm(f => ({ ...f, memory_enabled: e.target.checked }))}
                  className="w-4 h-4 accent-brand-500" />
                <label htmlFor="memEnabled" className="text-sm text-gray-300 cursor-pointer">Enable Memory</label>
              </div>

              {form.memory_enabled && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="label">Memory Strategy</span>
                      <select className="input" value={form.memory_type}
                        onChange={e => setForm(f => ({ ...f, memory_type: e.target.value }))}>
                        <option value="sliding_window">Sliding Window</option>
                        <option value="summary">Summary (LLM-compressed)</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="label">Window Size (messages)</span>
                      <input type="number" min={1} className="input" value={form.memory_window}
                        onChange={e => setForm(f => ({ ...f, memory_window: parseInt(e.target.value) }))} />
                    </label>
                  </div>

                  <label className="block">
                    <span className="label">Token Budget</span>
                    <input type="number" min={512} step={256} className="input"
                      value={form.memory_token_limit}
                      onChange={e => setForm(f => ({ ...f, memory_token_limit: parseInt(e.target.value) }))} />
                    <p className="text-xs text-gray-500 mt-1">
                      {form.memory_type === 'summary'
                        ? 'Older messages are compressed when total tokens exceed this limit'
                        : 'Informational only for sliding window mode'}
                    </p>
                  </label>

                  {form.memory_type === 'summary' && (
                    <div className="bg-purple-900/30 border border-purple-700/40 rounded-lg px-4 py-3 text-xs text-purple-300 space-y-1">
                      <p className="font-semibold">Summary Memory</p>
                      <p>When the context window exceeds the token budget, older turns are automatically
                        summarised by gpt-4o-mini and prepended as a synthetic &ldquo;system summary&rdquo; message.
                        Only the last <strong>{form.memory_window}</strong> raw messages are kept alongside it.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── MCP BINDINGS SECTION ── */}
          <SectionHeader title="MCP Server Bindings" icon="🔌" open={openSections.mcp}
            onToggle={() => toggleSection('mcp')} badge={mcpBadge} />
          {openSections.mcp && (
            <div className="space-y-4 pl-1">
              <p className="text-xs text-gray-400">
                Select MCP servers whose tools this agent can call. Optionally restrict to a whitelist of tool names.
              </p>

              {mcpServers.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  No MCP servers configured yet. Go to MCP Servers to add one.
                </p>
              ) : (
                <div className="space-y-2">
                  {mcpServers.map(srv => {
                    const selected = form.mcp_server_ids.includes(srv.id)
                    return (
                      <div
                        key={srv.id}
                        onClick={() => toggleMcpServer(srv.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          selected
                            ? 'border-brand-500 bg-brand-900/30'
                            : 'border-gray-700 hover:border-gray-500'
                        }`}
                      >
                        <input type="checkbox" readOnly checked={selected}
                          className="w-4 h-4 accent-brand-500 pointer-events-none" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200">{srv.name}</p>
                          <p className="text-xs text-gray-500">{srv.transport} · {
                            srv.capabilities?.tools?.length ?? 0} tools</p>
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          srv.status === 'connected' ? 'bg-green-400' :
                          srv.status === 'error' ? 'bg-red-400' : 'bg-gray-500'
                        }`} />
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Tool whitelist */}
              {form.mcp_server_ids.length > 0 && (
                <div>
                  <span className="label block mb-2">
                    Tool Whitelist{' '}
                    <span className="text-gray-500 font-normal">(leave empty = all tools allowed)</span>
                  </span>
                  <div className="flex gap-2 mb-2">
                    <input className="input flex-1" placeholder="tool_name" value={newWhitelistTool}
                      onChange={e => setNewWhitelistTool(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addWhitelistTool())} />
                    <button type="button" onClick={addWhitelistTool}
                      className="px-3 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 text-sm">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form.mcp_tool_whitelist.map((t: string) => (
                      <span key={t} className="flex items-center gap-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded-full text-xs text-gray-300">
                        {t}
                        <button type="button" onClick={() => removeWhitelistTool(t)}
                          className="text-gray-500 hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── HITL SECTION ── */}
          <SectionHeader title="Human-in-the-Loop (HITL)" icon="👤" open={openSections.hitl}
            onToggle={() => toggleSection('hitl')} badge={hitlBadge} />
          {openSections.hitl && (
            <div className="space-y-4 pl-1">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="hitlEnabled" checked={form.hitl_enabled}
                  onChange={e => setForm(f => ({ ...f, hitl_enabled: e.target.checked }))}
                  className="w-4 h-4 accent-purple-500" />
                <label htmlFor="hitlEnabled" className="text-sm text-gray-300 cursor-pointer">
                  Enable HITL breakpoints for this agent
                </label>
              </div>

              {form.hitl_enabled && (
                <>
                  <div className="bg-purple-900/30 border border-purple-700/40 rounded-lg px-4 py-3 text-xs text-purple-300">
                    <p>When enabled, this agent will pause execution and create a checkpoint in the HITL queue
                      for human review. Workflows remain blocked until a reviewer approves or rejects.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="label">Pause Every N Turns</span>
                      <input type="number" min={1} className="input" value={form.hitl_every_n_turns}
                        onChange={e => setForm(f => ({ ...f, hitl_every_n_turns: parseInt(e.target.value) }))} />
                      <p className="text-xs text-gray-500 mt-1">0 = only on explicit node; &gt;0 = auto-pause</p>
                    </label>
                    <label className="block">
                      <span className="label">Timeout (seconds)</span>
                      <input type="number" min={0} className="input" value={form.hitl_timeout_seconds}
                        onChange={e => setForm(f => ({ ...f, hitl_timeout_seconds: parseInt(e.target.value) }))} />
                      <p className="text-xs text-gray-500 mt-1">0 = wait indefinitely</p>
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── GUARDRAILS SECTION ── */}
          <SectionHeader title="Guardrails & Rate Limits" icon="🛡️" open={openSections.guardrails}
            onToggle={() => toggleSection('guardrails')} />
          {openSections.guardrails && (
            <div className="space-y-4 pl-1">
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="label">Max calls/minute</span>
                  <input type="number" className="input" value={form.guardrails.max_calls_per_minute}
                    onChange={e => setForm(f => ({
                      ...f, guardrails: { ...f.guardrails, max_calls_per_minute: parseInt(e.target.value) }
                    }))} />
                </label>
                <label className="block">
                  <span className="label">Forbidden Topics</span>
                  <input className="input" placeholder="violence, adult content..."
                    value={form.guardrails.forbidden_topics}
                    onChange={e => setForm(f => ({
                      ...f, guardrails: { ...f.guardrails, forbidden_topics: e.target.value }
                    }))} />
                </label>
              </div>

              {/* Skills */}
              <div>
                <span className="label block mb-2">Skills (extra context snippets)</span>
                <div className="flex gap-2 mb-2">
                  <input className="input flex-1" placeholder="Add a skill description..."
                    value={newSkill} onChange={e => setNewSkill(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill())} />
                  <button type="button" onClick={addSkill}
                    className="px-3 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 text-sm">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {form.skills.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5 mb-1">
                    <span className="flex-1 text-sm text-gray-300">{s}</span>
                    <button type="button" onClick={() => setForm(f => ({ ...f, skills: f.skills.filter((_: string, j: number) => j !== i) }))}>
                      <Trash2 className="w-3.5 h-3.5 text-gray-500 hover:text-red-400" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Schedule */}
              <label className="block">
                <span className="label">Schedule (cron, optional)</span>
                <input className="input font-mono" placeholder="e.g. 0 9 * * * (every day at 9am)"
                  value={form.schedule}
                  onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} />
              </label>
            </div>
          )}

          {/* ── CHANNELS SECTION ── */}
          <SectionHeader title="Channels" icon="📡" open={openSections.channels}
            onToggle={() => toggleSection('channels')} />
          {openSections.channels && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Connect this agent to messaging channels</span>
                <button type="button" onClick={addChannel}
                  className="text-xs text-brand-500 hover:text-brand-400 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Channel
                </button>
              </div>
              {form.channels.map((ch, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="input flex-1" value={ch.channel}
                    onChange={e => {
                      const updated = [...form.channels]
                      updated[i] = { ...updated[i], channel: e.target.value as 'telegram' | 'slack' | 'whatsapp' }
                      setForm(f => ({ ...f, channels: updated }))
                    }}>
                    <option value="telegram">Telegram</option>
                    <option value="slack">Slack</option>
                  </select>
                  <button type="button" onClick={() => removeChannel(i)}>
                    <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-400" />
                  </button>
                </div>
              ))}
              {form.channels.length === 0 && (
                <p className="text-xs text-gray-500 italic">No channels configured</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : (agent ? 'Update Agent' : 'Create Agent')}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .label { @apply text-xs font-medium text-gray-400 mb-1 block; }
        .input { @apply w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                        focus:outline-none focus:border-brand-500 transition-colors; }
      `}</style>
    </div>
  )
}
