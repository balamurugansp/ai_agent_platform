import { useEffect, useState } from 'react'
import { Plus, GitFork, Trash2, ChevronRight, Edit2 } from 'lucide-react'
import toast from 'react-hot-toast'
import WorkflowCanvas from '../components/WorkflowCanvas/WorkflowCanvas'
import type { Workflow, Agent } from '../types'
import { workflowsApi } from '../api/workflows'
import { agentsApi } from '../api/agents'
import { useStore } from '../store/useStore'

export default function WorkflowsPage() {
  const { workflows, setWorkflows, agents, setAgents } = useStore()
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Workflow | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  useEffect(() => {
    Promise.all([
      workflowsApi.list(),
      agentsApi.list(),
    ]).then(([wfs, ags]) => {
      setWorkflows(wfs)
      setAgents(ags)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      const wf = await workflowsApi.create({ name: newName, description: newDesc })
      setWorkflows([wf, ...workflows])
      setSelected(wf)
      setCreating(false)
      setNewName('')
      setNewDesc('')
      toast.success('Workflow created!')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async (wf: Workflow, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete "${wf.name}"?`)) return
    try {
      await workflowsApi.delete(wf.id)
      setWorkflows(workflows.filter(w => w.id !== wf.id))
      if (selected?.id === wf.id) setSelected(null)
      toast.success('Workflow deleted')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleSaved = (updated: Workflow) => {
    setWorkflows(workflows.map(w => w.id === updated.id ? updated : w))
    setSelected(updated)
  }

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        {/* Breadcrumb */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 text-sm">
          <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white transition-colors">
            Workflows
          </button>
          <ChevronRight className="w-4 h-4 text-gray-700" />
          <span className="text-white font-medium">{selected.name}</span>
          {selected.template_name && (
            <span className="text-[10px] bg-purple-950 text-purple-400 px-2 py-0.5 rounded-full ml-1">
              template: {selected.template_name}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <WorkflowCanvas
            workflow={selected}
            agents={agents}
            onSaved={handleSaved}
            onRunStarted={(runId) => {
              toast.success(`Run started! Check Monitor tab.`)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Workflows</h1>
          <p className="text-xs text-gray-500 mt-0.5">Build multi-agent pipelines with visual drag-and-drop</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 rounded-lg text-sm text-white font-medium"
        >
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && <p className="text-gray-500 text-sm text-center py-12">Loading…</p>}

        {!loading && workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48">
            <GitFork className="w-12 h-12 text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No workflows yet</p>
            <p className="text-gray-600 text-xs mt-1">Visit Templates to get started quickly</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map(wf => (
            <div key={wf.id}
              onClick={() => setSelected(wf)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-brand-500/50 cursor-pointer transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GitFork className="w-4 h-4 text-brand-400" />
                  <span className="font-medium text-white text-sm">{wf.name}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => handleDelete(wf, e)}
                    className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {wf.description && (
                <p className="text-xs text-gray-400 line-clamp-2 mb-3">{wf.description}</p>
              )}
              <div className="flex items-center justify-between text-[10px] text-gray-600">
                <span>{wf.nodes.length} agent{wf.nodes.length !== 1 ? 's' : ''} · {wf.edges.length} edge{wf.edges.length !== 1 ? 's' : ''}</span>
                {wf.template_name && (
                  <span className="bg-purple-950/50 text-purple-500 px-1.5 py-0.5 rounded">{wf.template_name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-96 p-5">
            <h3 className="font-semibold text-white mb-4">New Workflow</h3>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 mb-3"
              placeholder="Workflow name *" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 mb-4 resize-none"
              placeholder="Description (optional)" rows={3} value={newDesc}
              onChange={e => setNewDesc(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)}
                className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">Cancel</button>
              <button onClick={handleCreate}
                className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
