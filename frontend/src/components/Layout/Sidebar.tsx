import { NavLink } from 'react-router-dom'
import {
  Bot, GitFork, Activity, LayoutTemplate, Zap,
  Server, UserCheck, Network, BarChart3,
} from 'lucide-react'

const nav = [
  { section: 'Agents & Workflows' },
  { to: '/agents',    icon: Bot,           label: 'Agents'           },
  { to: '/workflows', icon: GitFork,       label: 'Workflows'        },
  { to: '/builder',   icon: Network,       label: 'Topology Builder' },
  { to: '/templates', icon: LayoutTemplate,label: 'Templates'        },
  { section: 'Intelligence' },
  { to: '/mcp',       icon: Server,        label: 'MCP Servers'      },
  { to: '/hitl',      icon: UserCheck,     label: 'HITL Approvals'   },
  { section: 'Observability' },
  { to: '/observe',   icon: BarChart3,     label: 'Dashboard'        },
  { to: '/monitor',   icon: Activity,      label: 'Live Monitor'     },
]

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-2">
        <Zap className="text-brand-500 w-5 h-5" />
        <span className="font-bold text-white text-sm tracking-wide">Yuno AI</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {nav.map((item, idx) => {
          if ('section' in item) {
            return (
              <p key={idx} className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 pt-4 pb-1 first:pt-2">
                {item.section}
              </p>
            )
          }
          const { to, icon: Icon, label } = item as { to: string; icon: any; label: string }
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-600">
        v2.0.0 · Yuno AI Platform
      </div>
    </aside>
  )
}
