import { api } from './client'
import type { WorkflowRun } from '../types'

export const runsApi = {
  list: () => api.get<WorkflowRun[]>('/runs').then(r => r.data),
  get: (id: string) => api.get<WorkflowRun>(`/runs/${id}`).then(r => r.data),
}
