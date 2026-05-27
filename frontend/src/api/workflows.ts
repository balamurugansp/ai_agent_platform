import { api } from './client'
import type { Workflow, WorkflowRun } from '../types'

export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows').then(r => r.data),
  get: (id: string) => api.get<Workflow>(`/workflows/${id}`).then(r => r.data),
  create: (data: Partial<Workflow>) => api.post<Workflow>('/workflows', data).then(r => r.data),
  update: (id: string, data: Partial<Workflow>) => api.put<Workflow>(`/workflows/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  run: (id: string, message: string) =>
    api.post<WorkflowRun>(`/workflows/${id}/run`, { message }).then(r => r.data),
  listRuns: (id: string) => api.get<WorkflowRun[]>(`/workflows/${id}/runs`).then(r => r.data),
}
