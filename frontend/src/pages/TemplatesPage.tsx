import { useEffect, useState } from 'react'
import { LayoutTemplate, ArrowRight, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { workflowsApi } from '../api/workflows'
import type { Workflow } from '../types'
import { useStore } from '../store/useStore'
import { useNavigate } from 'react-router-dom'

const TEMPLATE_META: Record<string, { icon: string; color: string; details: string[] }> = {
  research_report: {
    icon: '🔍',
    color: 'border-blue-500/40 hover:border-blue-500',
    details: [
      'Orchestrator delegates research task',
      'ResearchAgent uses web_search tool',
      'WriterAgent formats a polished report',
      'Linear 3-agent pipeline',
    ],
  },
  customer_support: {
    icon: '💬',
    color: 'border-green-500/40 hover:border-green-500',
    details: [
      'TriageAgent classifies the request',
      'Routes to SupportAgent or EscalationAgent',
      'Conditional branching on message content',
      'Demonstrates agent-to-agent routing',
    ],
  },
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [cloned, setCloned] = useState<Set<string>>(new Set())
  const { setWorkflows, workflows } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    workflowsApi.list().then(all => {
      setTemplates(all.filter(w => w.template_name))
      setWorkflows(all)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const useTemplate = async (tmpl: Workflow) => {
    try {
      const clonedWf = await workflowsApi.create({
        name: `${tmpl.name} (copy)`,
        description: tmpl.description,
        nodes: tmpl.nodes,
        edges: tmpl.edges,
        entry_point: tmpl.entry_point,
      })
      setWorkflows([clonedWf, ...workflows])
      setCloned(s => new Set([...s, tmpl.id]))
      toast.success('Template cloned! Opening in Workflows…')
      setTimeout(() => navigate('/workflows'), 800)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-white">Templates</h1>
        <p className="text-xs text-gray-500 mt-0.5">Pre-built multi-agent workflows ready to use</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && <p className="text-gray-500 text-sm text-center py-12">Loading…</p>}

        {!loading && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48">
            <LayoutTemplate className="w-12 h-12 text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm">No templates found</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          {templates.map(tmpl => {
            const meta = TEMPLATE_META[tmpl.template_name!] || { icon: '🤖', color: 'border-gray-700', details: [] }
            const isCloned = cloned.has(tmpl.id)
            return (
              <div key={tmpl.id}
                className={`bg-gray-900 border rounded-xl p-6 transition-all ${meta.color}`}>
                {/* Header */}
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-3xl">{meta.icon}</span>
                  <div>
                    <h3 className="font-semibold text-white text-base">{tmpl.name}</h3>
                    <p className="text-sm text-gray-400 mt-0.5">{tmpl.description}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-4 mb-4 text-xs text-gray-500">
                  <span>🤖 {tmpl.nodes.length} agents</span>
                  <span>→ {tmpl.edges.length} connections</span>
                  <span className="text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded-full">
                    {tmpl.template_name}
                  </span>
                </div>

                {/* Details */}
                <ul className="space-y-1.5 mb-5">
                  {meta.details.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>

                {/* Agents Preview */}
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {tmpl.nodes.map(n => (
                    <span key={n.id} className="text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded-full">
                      {(n.data as any)?.label || 'Agent'}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => useTemplate(tmpl)}
                  disabled={isCloned}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isCloned
                      ? 'bg-green-900/30 text-green-400 cursor-default'
                      : 'bg-brand-500 hover:bg-brand-600 text-white'
                  }`}
                >
                  {isCloned ? (
                    <><CheckCircle className="w-4 h-4" /> Cloned!</>
                  ) : (
                    <>Use Template <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Custom template guide */}
        <div className="mt-8 max-w-4xl bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-white mb-2">Adding Custom Templates</h3>
          <p className="text-sm text-gray-400 mb-3">
            Add your own templates by appending to the <code className="text-brand-400 bg-gray-800 px-1 rounded">TEMPLATES</code> list in{' '}
            <code className="text-brand-400 bg-gray-800 px-1 rounded">backend/app/services/workflow_service.py</code>.
          </p>
          <div className="font-mono text-xs text-gray-500 bg-gray-950 rounded-lg p-3 overflow-x-auto">
            <span className="text-gray-600"># Each template needs:</span><br />
            {'{ "name": "My Template", "template_name": "my_tmpl",'}<br />
            {'  "description": "...", "agents": [...], "edge_sequence": [0,1,2] }'}
          </div>
        </div>
      </div>
    </div>
  )
}
