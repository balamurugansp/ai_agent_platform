import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bot, Wrench, Brain } from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  orchestrator: 'border-purple-500 bg-purple-950',
  researcher:   'border-blue-500   bg-blue-950',
  writer:       'border-green-500  bg-green-950',
  classifier:   'border-yellow-500 bg-yellow-950',
  support:      'border-teal-500   bg-teal-950',
  escalation:   'border-red-500    bg-red-950',
  assistant:    'border-brand-500  bg-gray-900',
  custom:       'border-gray-500   bg-gray-900',
}

export default memo(function AgentNode({ data, selected }: NodeProps) {
  const role = (data.role as string) || 'assistant'
  const colorClass = ROLE_COLORS[role] || ROLE_COLORS.assistant
  const tools = (data.tools as string[]) || []

  return (
    <div className={`
      min-w-[180px] rounded-xl border-2 px-4 py-3 text-white shadow-lg transition-all
      ${colorClass}
      ${selected ? 'ring-2 ring-white/30' : ''}
    `}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-2.5 !h-2.5" />

      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-4 h-4 opacity-70" />
        <span className="font-semibold text-sm truncate max-w-[130px]">{data.label as string}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-1">
        <span className={`
          text-[10px] px-2 py-0.5 rounded-full font-medium capitalize
          ${selected ? 'bg-white/20' : 'bg-black/30'}
        `}>{role}</span>
        {(data.memory_enabled as boolean) && (
          <span title="Memory enabled"><Brain className="w-3 h-3 opacity-60" /></span>
        )}
      </div>

      {tools.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          <Wrench className="w-3 h-3 opacity-50" />
          {tools.slice(0, 3).map(t => (
            <span key={t} className="text-[9px] bg-black/30 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          {tools.length > 3 && (
            <span className="text-[9px] opacity-50">+{tools.length - 3}</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2.5 !h-2.5" />
    </div>
  )
})
