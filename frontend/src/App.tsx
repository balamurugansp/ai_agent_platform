import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Layout/Sidebar'
import AgentsPage from './pages/AgentsPage'
import WorkflowsPage from './pages/WorkflowsPage'
import MonitorPage from './pages/MonitorPage'
import TemplatesPage from './pages/TemplatesPage'
import MCPServersPage from './pages/MCPServersPage'
import HITLPage from './pages/HITLPage'
import WorkflowBuilderPage from './pages/WorkflowBuilderPage'
import ObservabilityPage from './pages/ObservabilityPage'

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/builder" element={<WorkflowBuilderPage />} />
          <Route path="/observe" element={<ObservabilityPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
          <Route path="/mcp" element={<MCPServersPage />} />
          <Route path="/hitl" element={<HITLPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
        </Routes>
      </main>
    </div>
  )
}
