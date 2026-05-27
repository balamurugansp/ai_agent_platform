import { create } from 'zustand'
import type { Agent, Workflow, WorkflowRun, WsEvent } from '../types'

interface Store {
  agents: Agent[]
  workflows: Workflow[]
  runs: WorkflowRun[]
  liveEvents: WsEvent[]

  setAgents: (agents: Agent[]) => void
  setWorkflows: (workflows: Workflow[]) => void
  setRuns: (runs: WorkflowRun[]) => void
  addRun: (run: WorkflowRun) => void
  updateRun: (run: Partial<WorkflowRun> & { id: string }) => void
  addLiveEvent: (event: WsEvent) => void
  clearLiveEvents: () => void
}

export const useStore = create<Store>((set) => ({
  agents: [],
  workflows: [],
  runs: [],
  liveEvents: [],

  setAgents: (agents) => set({ agents }),
  setWorkflows: (workflows) => set({ workflows }),
  setRuns: (runs) => set({ runs }),
  addRun: (run) => set((s) => ({ runs: [run, ...s.runs] })),
  updateRun: (partial) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === partial.id ? { ...r, ...partial } : r)),
    })),
  addLiveEvent: (event) =>
    set((s) => ({ liveEvents: [event, ...s.liveEvents].slice(0, 500) })),
  clearLiveEvents: () => set({ liveEvents: [] }),
}))
