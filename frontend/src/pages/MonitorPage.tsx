import MonitorPanel from '../components/Monitor/MonitorPanel'

export default function MonitorPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-white">Monitor</h1>
        <p className="text-xs text-gray-500 mt-0.5">Real-time logs, inter-agent messages, token usage and cost tracking</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <MonitorPanel runId="__global__" />
      </div>
    </div>
  )
}
