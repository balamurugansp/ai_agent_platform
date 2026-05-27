import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Bot, Wrench, Brain } from 'lucide-react'
import toast from 'react-hot-toast'
import AgentForm from '../components/AgentBuilder/AgentForm'
import type { Agent } from '../types'
import { agentsApi } from '../api/agents'
import { useStore } from '../store/useStore'

export default function AgentsPage() {
  const { agents, setAgents } = useStore()
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | null>(null)

  useEffect(() => {
    agentsApi.list().then(a => { setAgents(a); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return
    try {
      await agentsApi.delete(agent.id)
      setAgents(agents.filter(a => a.id !== agent.id))
      toast.success('Agent deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleSaved = (agent: Agent) => {
    if (editAgent) {
      setAgents(agents.map(a => a.id === agent.id ? agent : a))
    } else {
      setAgents([agent, ...agents])
    }
    setShowForm(false)
    setEditAgent(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Agents</h1>
          <p className="text-xs text-gray-500 mt-0.5">Configure AI agents with personalities, tools, and channels</p>
        </div>
        <button
          onClick={() => { setEditAgent(null); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 rounded-lg text-sm text-white font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Agent
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500 text-sm">Loading agents…</div>
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48">
            <Bot className="w-12 h-12 text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No agents yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-brand-500 hover:text-brand-400 text-sm"
            >
              Create your first agent →
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map(agent => (
            <div key={agent.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors group"
            >
              {/* Icon + Name */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand-500/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white text-sm leading-tight">{agent.name}</div>
                    <div className="text-[10px] text-gray-500 capitalize">{agent.role}</div>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditAgent(agent); setShowForm(true) }}
                    className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(agent)}
                    className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-400 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Model */}
              <div className="text-xs text-gray-500 mb-2 font-mono">{agent.model}</div>

              {/* Prompt preview */}
              <p className="text-xs text-gray-400 line-clamp-2 mb-3">{agent.system_prompt}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {agent.tools.slice(0, 3).map(t => (
                  <span key={t} className="flex items-center gap-1 text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                    <Wrench className="w-2.5 h-2.5" /> {t}
                  </span>
                ))}
                {agent.tools.length > 3 && (
                  <span className="text-[10px] text-gray-600">+{agent.tools.length - 3} more</span>
                )}
                {agent.memory_enabled && (
                  <span className="flex items-center gap-1 text-[10px] bg-purple-950/50 text-purple-400 px-2 py-0.5 rounded-full">
                    <Brain className="w-2.5 h-2.5" /> memory
                  </span>
                )}
                {agent.channels.length > 0 && agent.channels.map((ch, i) => (
                  <span key={i} className="text-[10px] bg-green-950/50 text-green-400 px-2 py-0.5 rounded-full">
                    {ch.channel}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(showForm) && (
        <AgentForm
          agent={editAgent}
          onSave={handleSaved}
          onClose={() => { setShowForm(false); setEditAgent(null) }}
        />
      )}
    </div>
  )
}
